import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/test-utils/fakeSupabase'

// ─── בדיקת webhook/route.ts: התקבלות webhook אמיתי מ-Green API -> שליפת
// lastIncomingMessages (מדומה) -> יצירת/מציאת שיחה -> שמירת הודעה עם הגנת
// דה-דופליקציה (אינדקס ייחודי מדומה) -> טיפול במדיה -> הפעלת ai-respond ברקע
// דרך after() (מדומה כדי לרוץ באופן סינכרוני בבדיקה).

let fakeDb: FakeDb
let outgoingFetchCalls: { url: string }[] = []
let lastIncomingMessages: any[] = []

beforeEach(() => {
  fakeDb = new FakeDb()
  fakeDb.setUniqueConstraint('messages', ['whatsapp_message_id'])
  outgoingFetchCalls = []
  lastIncomingMessages = []

  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-key')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://betterlead.vercel.app')

  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => fakeDb.client(),
  }))

  vi.doMock('next/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('next/server')>()
    return { ...actual, after: (fn: () => Promise<void> | void) => fn() }
  })

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    outgoingFetchCalls.push({ url })
    if (url.includes('lastIncomingMessages')) {
      return { ok: true, json: async () => lastIncomingMessages } as any
    }
    if (url.includes('/api/whatsapp/ai-respond')) {
      return { ok: true, json: async () => ({ ok: true }) } as any
    }
    // הורדת קובץ מדיה
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as any
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('@supabase/supabase-js')
  vi.doUnmock('next/server')
})

function seedBaseline() {
  fakeDb.seed('whatsapp_connections', [{
    id: 'conn1', business_id: 'biz1', instance_id: '12345',
    bot_enabled: true, api_token: 'tok', api_url: 'https://x.api.greenapi.com',
  }])
  fakeDb.seed('conversations', [])
  fakeDb.seed('messages', [])
  fakeDb.seed('leads', [])
  fakeDb.seed('lead_files', [])
}

async function callWebhook(body: Record<string, unknown>) {
  vi.resetModules()
  const { POST } = await import('./route')
  const req = new NextRequest('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { host: 'betterlead.vercel.app', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  })
  return POST(req)
}

const webhookBody = {
  typeWebhook: 'incomingMessageReceived',
  instanceData: { idInstance: 12345 },
}

describe('webhook POST — incoming message pipeline (real business logic, fake network)', () => {
  it('creates a conversation, saves the message, and triggers ai-respond in the background', async () => {
    seedBaseline()
    lastIncomingMessages = [{
      idMessage: 'wa-1', chatId: '972500000000@c.us', senderName: 'דנה',
      typeMessage: 'textMessage', textMessage: 'שלום, אני רוצה תור',
    }]

    const res = await callWebhook(webhookBody)
    expect((await res.json()).ok).toBe(true)

    expect(fakeDb.tables.conversations).toHaveLength(1)
    expect(fakeDb.tables.conversations[0].contact_phone).toBe('972500000000')

    const savedMsg = fakeDb.tables.messages.find((m: any) => m.whatsapp_message_id === 'wa-1')
    expect(savedMsg).toBeTruthy()
    expect(savedMsg!.content).toBe('שלום, אני רוצה תור')

    const aiCall = outgoingFetchCalls.find(c => c.url.includes('/api/whatsapp/ai-respond'))
    expect(aiCall).toBeTruthy()
  })

  it('does not process the same whatsapp message twice (unique-constraint dedup) and does not trigger ai-respond again', async () => {
    seedBaseline()
    fakeDb.tables.conversations.push({
      id: 'conv1', business_id: 'biz1', contact_phone: '972500000000',
      contact_name: 'דנה', bot_enabled: true, status: 'active',
    })
    // ההודעה כבר עובדה בעבר (כמו שיוצא מ-request מקביל שהגיע קודם)
    fakeDb.tables.messages.push({
      id: 'm-old', conversation_id: 'conv1', business_id: 'biz1',
      direction: 'inbound', content: 'שלום, אני רוצה תור', sender_type: 'contact',
      whatsapp_message_id: 'wa-1',
    })
    lastIncomingMessages = [{
      idMessage: 'wa-1', chatId: '972500000000@c.us',
      typeMessage: 'textMessage', textMessage: 'שלום, אני רוצה תור',
    }]

    await callWebhook(webhookBody)

    // לא נוצרה הודעה כפולה
    expect(fakeDb.tables.messages.filter((m: any) => m.whatsapp_message_id === 'wa-1')).toHaveLength(1)
    // הבוט לא הופעל שוב
    const aiCall = outgoingFetchCalls.find(c => c.url.includes('/api/whatsapp/ai-respond'))
    expect(aiCall).toBeFalsy()
  })

  it('saves the message but does not trigger the bot when the conversation is under human_takeover', async () => {
    seedBaseline()
    fakeDb.tables.conversations.push({
      id: 'conv1', business_id: 'biz1', contact_phone: '972500000000',
      contact_name: 'דנה', bot_enabled: true, status: 'human_takeover',
    })
    lastIncomingMessages = [{
      idMessage: 'wa-2', chatId: '972500000000@c.us',
      typeMessage: 'textMessage', textMessage: 'תודה על העזרה',
    }]

    await callWebhook(webhookBody)

    const savedMsg = fakeDb.tables.messages.find((m: any) => m.whatsapp_message_id === 'wa-2')
    expect(savedMsg).toBeTruthy()

    const aiCall = outgoingFetchCalls.find(c => c.url.includes('/api/whatsapp/ai-respond'))
    expect(aiCall).toBeFalsy()
  })

  it('saves an image message with no caption using the default media label, uploads the file, and still triggers the bot', async () => {
    seedBaseline()
    lastIncomingMessages = [{
      idMessage: 'wa-3', chatId: '972500000000@c.us', senderName: 'דנה',
      typeMessage: 'imageMessage', downloadUrl: 'https://green.api/file.jpg',
      fileName: 'photo.jpg', mimeType: 'image/jpeg',
    }]

    await callWebhook(webhookBody)

    const savedMsg = fakeDb.tables.messages.find((m: any) => m.whatsapp_message_id === 'wa-3')
    expect(savedMsg).toBeTruthy()
    expect(savedMsg!.content).toBe('[תמונה]')

    // ליד נוצר כדי לשייך אליו את הקובץ
    expect(fakeDb.tables.leads).toHaveLength(1)
    // הקובץ אכן הועלה לאחסון המדומה
    expect(fakeDb.storageFiles.some(f => f.bucket === 'lead-files')).toBe(true)
    // ונשמר ברשומת lead_files
    expect(fakeDb.tables.lead_files).toHaveLength(1)
    expect(fakeDb.tables.lead_files[0].file_name).toBe('photo.jpg')

    const aiCall = outgoingFetchCalls.find(c => c.url.includes('/api/whatsapp/ai-respond'))
    expect(aiCall).toBeTruthy()
  })

  it('saves a stale/late-arriving message to history but does not trigger the bot when the conversation already moved past it', async () => {
    // תרחיש אמיתי: רשת הביטחון היומית (reconcile-messages cron) תופסת הודעה
    // ישנה שנפלה בזמן אמת בגלל תקלת חיבור, אבל בינתיים השיחה כבר המשיכה
    // והסתיימה בלעדיה — מענה אוטומטי עכשיו יהיה מנותק מהקשר ומבלבל
    seedBaseline()
    fakeDb.tables.conversations.push({
      id: 'conv1', business_id: 'biz1', contact_phone: '972500000000',
      contact_name: 'דנה', bot_enabled: true, status: 'active',
    })
    fakeDb.tables.messages.push({
      id: 'm-later', conversation_id: 'conv1', business_id: 'biz1',
      direction: 'outbound', content: 'תודה, מחכים לך!', sender_type: 'ai',
      created_at: '2026-08-06T15:00:00.000Z',
    })
    lastIncomingMessages = [{
      idMessage: 'wa-stale', chatId: '972500000000@c.us',
      typeMessage: 'textMessage', textMessage: 'הודעה ישנה שנפלה',
      timestamp: Math.floor(new Date('2026-08-06T14:50:00.000Z').getTime() / 1000),
    }]

    await callWebhook(webhookBody)

    const savedMsg = fakeDb.tables.messages.find((m: any) => m.whatsapp_message_id === 'wa-stale')
    expect(savedMsg).toBeTruthy()
    expect(savedMsg!.content).toBe('הודעה ישנה שנפלה')

    const aiCall = outgoingFetchCalls.find(c => c.url.includes('/api/whatsapp/ai-respond'))
    expect(aiCall).toBeFalsy()
  })

  it('does nothing when the whatsapp connection has the bot disabled', async () => {
    seedBaseline()
    fakeDb.tables.whatsapp_connections[0].bot_enabled = false
    lastIncomingMessages = [{
      idMessage: 'wa-4', chatId: '972500000000@c.us',
      typeMessage: 'textMessage', textMessage: 'שלום',
    }]

    const res = await callWebhook(webhookBody)
    expect((await res.json()).ok).toBe(true)

    expect(fakeDb.tables.conversations).toHaveLength(0)
    expect(fakeDb.tables.messages).toHaveLength(0)
    // אף לא ניגש ל-lastIncomingMessages בכלל — נעצר מוקדם יותר
    expect(outgoingFetchCalls.some(c => c.url.includes('lastIncomingMessages'))).toBe(false)
  })
})
