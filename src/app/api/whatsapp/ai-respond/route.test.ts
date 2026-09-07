import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeDb } from '@/test-utils/fakeSupabase'
import { israelDateTime } from '@/lib/botAppointments'

function israelDateTimeISO(dateISO: string, time: string): string {
  return israelDateTime(dateISO, time)!.toISOString()
}

// ─── בדיקת "מסלול מלא" של הבוט: הודעת לקוח אמיתית -> נכנסת ל-POST handler
// האמיתי של ai-respond -> OpenAI (מדומה) מחזיר תשובה עם תגית APPT -> נשמר
// תור אמיתי דרך saveOrRescheduleBotAppointment האמיתי (לא מדומה!) -> הודעה
// יוצאת נשלחת דרך Green API (מדומה) -> נשמרת ב-DB. רק הרשת החיצונית
// (OpenAI, Green API) והמסד מדומים — כל שאר הלוגיקה העסקית היא הקוד האמיתי.

let fakeDb: FakeDb
let openaiReply = ''
let sentMessages: { url: string; body: any }[] = []
let openaiCalls: { systemPrompt: string; userMessage: string }[] = []

beforeEach(() => {
  fakeDb = new FakeDb()
  sentMessages = []
  openaiCalls = []
  openaiReply = ''

  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-key')
  vi.stubEnv('OPENAI_API_KEY', 'fake-openai-key')

  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => fakeDb.client(),
  }))

  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
    if (url.includes('api.openai.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null
      openaiCalls.push({
        systemPrompt: body?.messages?.find((m: any) => m.role === 'system')?.content || '',
        userMessage: body?.messages?.filter((m: any) => m.role === 'user')?.slice(-1)[0]?.content || '',
      })
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: openaiReply } }] }),
      } as any
    }
    // Green API — typing indicator / sendMessage
    sentMessages.push({ url, body: opts?.body ? JSON.parse(opts.body) : null })
    if (url.includes('sendMessage')) {
      return { ok: true, json: async () => ({ idMessage: 'wa-msg-1' }), text: async () => '' } as any
    }
    return { ok: true, json: async () => ({}), text: async () => '' } as any
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('@supabase/supabase-js')
})

function seedBaseline() {
  fakeDb.seed('businesses', [{
    id: 'biz1',
    name: 'שקד קליניק',
    address: 'רח\' פתח תקווה 6, נתניה',
    website: 'https://shakedmed88.co.il',
    phone: '0559851207',
    settings: {
      goal: 'appointment',
      services: [{ name: 'הלבנה', active: true, duration: '45' }],
      working_hours_table: [
        { day: 'ראשון', open: '09:00', close: '18:00', closed: false },
        { day: 'שני', open: '09:00', close: '18:00', closed: false },
        { day: 'שלישי', open: '09:00', close: '18:00', closed: false },
        { day: 'רביעי', open: '09:00', close: '18:00', closed: false },
        { day: 'חמישי', open: '09:00', close: '18:00', closed: false },
        { day: 'שישי', open: '09:00', close: '13:00', closed: false },
        { day: 'שבת', open: '', close: '', closed: true },
      ],
    },
  }])
  fakeDb.seed('conversations', [{ id: 'conv1', business_id: 'biz1', contact_phone: '972500000000', contact_name: null, lead_id: null, bot_enabled: true, status: 'active' }])
  fakeDb.seed('messages', [{ id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה ביום שלישי בשעה 12:00, קוראים לי דנה', sender_type: 'contact' }])
  fakeDb.seed('qa_knowledge', [])
  fakeDb.seed('profiles', [])
  fakeDb.seed('whatsapp_connections', [{ id: 'conn1', business_id: 'biz1', api_token: 'tok', api_url: 'https://x.api.greenapi.com', instance_id: '12345', bot_enabled: true }])
  fakeDb.seed('leads', [])
  fakeDb.seed('appointments', [])
  fakeDb.seed('knowledge_gaps', [])
}

// (multi-tenant isolation): הפיצ'ר הדטרמיניסטי לחזרה מאוחרת (REMIND) גדור
// מאחורי business.settings.enforce_callback_reminders — ברירת המחדל false,
// לא נוגעים בזה בביקורת הכללית (seedBaseline). עסקים שבודקים את הפיצ'ר
// הזה בפועל (שקד קליניק לדוגמה) מפעילים את זה במפורש
function seedCallbackEnabledBaseline() {
  seedBaseline()
  fakeDb.tables.businesses[0].settings.enforce_callback_reminders = true
}

// דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה — ראה הסבר מלא
// באותה פונקציה ב-botAppointments.test.ts (אותו באג, אותו תיקון)
function nextWeekday(target: number, baseISO?: string): string {
  const base = baseISO
    ? new Date(`${baseISO}T12:00:00Z`)
    : (() => {
        const now = new Date()
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
      })()
  const offset = ((target - base.getUTCDay() + 7) % 7) || 7
  return new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10)
}

async function callAiRespond(body: Record<string, unknown>) {
  vi.resetModules()
  const { POST } = await import('./route')
  const req = new NextRequest('http://localhost/api/whatsapp/ai-respond', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return POST(req)
}

describe('ai-respond POST — full pipeline (real business logic, fake network)', () => {
  it('books a real appointment end-to-end when the model confirms one, and sends the WhatsApp message', async () => {
    seedBaseline()
    const tuesday = nextWeekday(2)
    openaiReply = `מעולה דנה! קבענו לך תור להלבנה ביום שלישי ה-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"דנה","reason":"הלבנה","temperature":"hot","status":"published"}
APPT:{"date":"${tuesday}","time":"12:00","service":"הלבנה"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אני רוצה תור',
    })
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.appointment?.ok).toBe(true)

    // תור אמיתי נשמר ב"מסד" המדומה, עם הזמן הנכון
    expect(fakeDb.tables.appointments).toHaveLength(1)
    expect(fakeDb.tables.appointments[0].patient_phone).toBe('972500000000')
    expect(fakeDb.tables.appointments[0].treatment_type).toBe('הלבנה')

    // הודעה יוצאת נשלחה בפועל דרך Green API (מדומה) ונשמרה — תמיד הסיכום
    // המאומת מה-DB (לא הניסוח החופשי של המודל), כדי שלא יהיו שני בלוקים
    // סותרים/חוזרים על אותו מידע בהודעה אחת ללקוח
    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall).toBeTruthy()
    expect(sendCall!.body.message).toContain('קבעתי לך תור')
    expect(sendCall!.body.message).toContain(tuesday.split('-').reverse().join('.'))

    const outbound = fakeDb.tables.messages.find((m: any) => m.direction === 'outbound')
    expect(outbound).toBeTruthy()

    // הליד עודכן עם השם והסטטוס מהתגית LEAD
    expect(fakeDb.tables.leads).toHaveLength(1)
    expect(fakeDb.tables.leads[0].status).toBe('published')
  })

  // קרה בפועל (חיים, 18/08): המודל כתב APPT.service="יישור שיניים" (ניסוח
  // יומיומי של הלקוח), אבל בהגדרות העסק השירות רשום כ"אורתודנטיה" (מונח
  // פורמלי) — אי-ההתאמה המילולית גרמה לכך שלא שויך רופא לתור בכלל, וכתוצאה
  // מזה גם שהתור לא סונכרן לאופטימה (אין קוד רופא בלי רופא משויך)
  it('assigns the right doctor even when the model uses a colloquial service name that differs from the configured one', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'אורתודנטיה', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { doc1: ['אורתודנטיה'] }
    fakeDb.seed('profiles', [{ id: 'doc1', full_name: 'ד"ר מסאוורה', business_id: 'biz1' }])
    const tuesday = nextWeekday(2)

    openaiReply = `מעולה! קבענו לך תור ליישור שיניים ביום שלישי ה-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"חיים","reason":"יישור שיניים"}
APPT:{"date":"${tuesday}","time":"12:00","service":"יישור שיניים"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה יישור שיניים',
    })
    const json = await res.json()

    expect(json.appointment?.ok).toBe(true)
    expect(fakeDb.tables.appointments).toHaveLength(1)
    // הרופא היחיד שמוגדר ל"אורתודנטיה" שויך בפועל, למרות שהלקוח/המודל
    // כתבו "יישור שיניים" ולא את שם השירות הפורמלי
    expect(fakeDb.tables.appointments[0].assigned_to).toBe('doc1')

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('ד"ר מסאוורה')
  })

  // קרה בפועל (אלינה מינסקי, 18/08): הבוט הזכיר "ד"ר גבי סמל" ללקוח פעמיים
  // בשיחה (שני רופאים מוסמכים לאותו שירות), אבל הרוטציה לפי עומס שייכה
  // בפועל את ד"ר עלא יונס — הלקוח קיבל אישור סופי עם שם רופא שונה ממה
  // שהובטח לו. בודקים שהתור נשמר עם הרופא שכבר הוזכר, לא עם מי שהרוטציה
  // הייתה בוחרת אילולא הובטח שם מפורש
  it('books with the doctor the bot already named in the conversation, not whoever load-balancing would otherwise pick', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
    fakeDb.seed('profiles', [
      { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
      { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
    ])
    const tuesday = nextWeekday(2)
    // docA (מי שהובטח בשיחה) עמוס יותר בתורים עתידיים מ-docB — ברוטציה
    // "רגילה" (לפי עומס) docB היה נבחר; אם למרות זאת נבחר docA, זה כי
    // ההבטחה בשיחה כובדה, לא בגלל הרוטציה
    fakeDb.tables.appointments = Array.from({ length: 5 }, (_, i) => ({
      id: `existing-${i}`, business_id: 'biz1', assigned_to: 'docA', status: 'scheduled',
      scheduled_at: new Date(Date.now() + (i + 10) * 86400000).toISOString(), duration_minutes: 60,
    }))
    fakeDb.tables.messages.push({
      id: 'm-doc-mention', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound',
      content: 'יש לנו תורים פנויים עם ד"ר גבי סמל, מומחה להשתלות', sender_type: 'ai',
      created_at: new Date(Date.now() - 60000).toISOString(),
    })

    openaiReply = `נרשום אותך לפגישה עם ד"ר גבי סמל ביום שלישי ה-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"אלינה","reason":"השתלות"}
APPT:{"date":"${tuesday}","time":"12:00","service":"השתלות"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אוקי',
    })
    const json = await res.json()

    expect(json.appointment?.ok).toBe(true)
    const created = fakeDb.tables.appointments.find((a: any) => a.notes === 'נקבע אוטומטית על ידי הבוט')
    expect(created!.assigned_to).toBe('docA')

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('ד"ר גבי סמל')
  })

  // קרה בפועל (18/08): מספר טלפון כתב "צרויה אבנר" לפני 19 יום ונשמר כשם
  // מאומת. שבועות אחר כך אותו מספר כתב שוב עם הודעת הפתיחה הטיפוסית
  // ("הגעתי דרך המודעה") שנראית כמו פנייה חדשה — והבוט פתח מיד עם השם
  // הישן, שהתברר בהמשך שהוא בכלל לא נכון ("אני בן"). בודקים שהפרומפט
  // שנשלח למודל לא כולל הרשאה להשתמש בשם השמור במקרה כזה
  it('does not let the model use a name saved from an old conversation when this message looks like a fresh lead opener', async () => {
    seedBaseline()
    fakeDb.tables.conversations[0].verified_first_name = 'צרויה'
    fakeDb.tables.conversations[0].verified_first_name_source = 'explicit_user_message'
    openaiReply = 'היי! נעים להכיר 😊 איך אפשר לעזור?'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000',
      messageText: 'היי, שלום, הגעתי דרך המודעה בפייסבוק ורציתי לקבל פרטים נוספים.',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).not.toContain('מותר להשתמש בשם "צרויה"')
    expect(prompt).toContain('כנראה פנייה חדשה')
  })

  // קרה בפועל (יוסי, 20/08): הבוט "החליק" למין נקבה בהתייחסות לעצמו
  // ("אני מבינה", "אני ממליצה") בהודעות שבהן פנה ללקוחה בלשון נקבה —
  // מין הבוט וכיוון הפנייה ללקוח/ה הם שני דברים נפרדים לגמרי
  it('always instructs the bot to refer to itself in masculine grammatical form, regardless of the customer\'s gender', async () => {
    seedBaseline()
    openaiReply = 'היי! 😊 איך אפשר לעזור?'
    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אני מחפשת טיפול',
    })
    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('המין הדקדוקי שלך')
    expect(prompt).toContain('תמיד זכר')
  })

  it('still allows the saved name for an ordinary follow-up message (not a fresh-opener)', async () => {
    seedBaseline()
    fakeDb.tables.conversations[0].verified_first_name = 'צרויה'
    fakeDb.tables.conversations[0].verified_first_name_source = 'explicit_user_message'
    openaiReply = 'יש לנו תור פנוי ביום שלישי 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם תור פנוי?',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('מותר להשתמש בשם "צרויה"')
  })

  it('rejects a booking outside working hours and sends a natural message instead of a technical error', async () => {
    seedBaseline()
    const saturday = nextWeekday(6) // שבת — סגור לגמרי
    openaiReply = `אין בעיה! קבענו לך לשבת בשעה 10:00
LEAD:{"name":"דנה","reason":"הלבנה"}
APPT:{"date":"${saturday}","time":"10:00","service":"הלבנה"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'קבעי לי לשבת',
    })
    const json = await res.json()

    expect(json.appointment?.ok).toBe(false)
    expect(json.appointment?.error).toBe('outside_working_hours')
    expect(fakeDb.tables.appointments).toHaveLength(0)

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('מחוץ לשעות הפעילות')
    expect(sendCall!.body.message).not.toContain('תקלה טכנית')
  })

  // קרה בפועל: ימי סגירה (חג/חופשה) הגיעו לבוט רק כהקשר בפרומפט, בלי שום
  // אכיפה בקוד — בדיוק כמו הפער שהיה קודם בשעות פעילות. בודקים שהתור
  // נדחה בפועל, לא רק שמבקשים מהמודל "בבקשה אל תציע"
  it('rejects a booking on a date listed as a business closure exception, even though the model confirmed it', async () => {
    seedBaseline()
    const tuesday = nextWeekday(2)
    fakeDb.tables.businesses[0].settings.business_exceptions = [{ date: tuesday, reason: 'חג' }]
    openaiReply = `בטח! קבענו לך תור ל-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"דנה","reason":"הלבנה"}
APPT:{"date":"${tuesday}","time":"12:00","service":"הלבנה"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'קבעי לי תור',
    })
    const json = await res.json()

    expect(json.appointment?.ok).toBe(false)
    expect(json.appointment?.error).toBe('business_closed')
    expect(fakeDb.tables.appointments).toHaveLength(0)

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('סגורים')
    expect(sendCall!.body.message).not.toContain('תקלה טכנית')
  })

  // קרה בפועל (יוסי, 19/08): לקוח קיים שאל "למי?" בשיחת המשך אחרי שתור
  // נקבע בלי רופא משויך (assignedTo null, בגלל אי-התאמת שם שירות), והבוט
  // ענה בשם רופא/ה שהוזכר/ה קודם בשיחה — מידע שלא היה מגובה בשום מקום
  // ב-DB. בודקים שהתגובה החופשית לא נשלחת ללקוח כשהיא סותרת את המציאות
  it('does not send a doctor name the model recalled freely when it contradicts the actual (or missing) assignment', async () => {
    seedBaseline()
    fakeDb.seed('profiles', [
      { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
      { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
    ])
    fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', name: 'יוסי', status: 'new' }])
    fakeDb.tables.conversations[0].lead_id = 'lead1'
    // תור קיים בלי רופא משויך בכלל — בדיוק המקרה שקרה בפועל
    fakeDb.seed('appointments', [{
      id: 'appt1', business_id: 'biz1', lead_id: 'lead1', patient_phone: '972500000000', status: 'scheduled',
      assigned_to: null, scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), created_at: new Date().toISOString(),
    }])
    openaiReply = 'התור קבוע לד"ר גבי סמל. 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'למי',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).not.toContain('גבי סמל')
  })

  it('does not block an informational doctor mention when the lead has no appointment yet (nothing to contradict)', async () => {
    seedBaseline()
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
    fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', name: 'יוסי', status: 'new' }])
    fakeDb.tables.conversations[0].lead_id = 'lead1'
    // אין שום תור קיים ללקוח — רק שיחת מידע כללית
    openaiReply = 'יש לנו תורים פנויים עם ד"ר גבי סמל, מומחה לשיקום הפה. מתי נוח לך?'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'יש רופא לשיקום הפה?',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('גבי סמל')
  })

  it('does not block a response naming a doctor when it correctly matches the real assignment', async () => {
    seedBaseline()
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
    fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', name: 'יוסי', status: 'new' }])
    fakeDb.tables.conversations[0].lead_id = 'lead1'
    fakeDb.seed('appointments', [{
      id: 'appt1', business_id: 'biz1', lead_id: 'lead1', patient_phone: '972500000000', status: 'scheduled', assigned_to: 'docA',
      scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), created_at: new Date().toISOString(),
    }])
    openaiReply = 'התור קבוע לד"ר גבי סמל. 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'למי',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('גבי סמל')
  })

  // קרה בפועל (25/08, לימור): לקוחה עם תור אמיתי ביומן (מסונכרן מאופטימה)
  // שאלה "תזכירי לי מתי קבענו תור" — הבוט לא קיבל שום מידע על התור הקיים
  // שלה בפרומפט, אז לא הייתה לו דרך לענות נכון חוץ מלהמציא/להתחמק. הבדיקה
  // מוודאת שהפרטים המדויקים של התור הקיים מוזרקים לפרומפט כעובדה מוכנה
  it('injects the customer\'s existing future appointment into the prompt so the bot can answer "when is my appointment" accurately instead of guessing', async () => {
    seedBaseline()
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר עלא יונס', business_id: 'biz1' }])
    fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', name: 'לימור', status: 'new' }])
    fakeDb.tables.conversations[0].lead_id = 'lead1'
    fakeDb.seed('appointments', [{
      id: 'appt1', business_id: 'biz1', lead_id: 'lead1', patient_phone: '972500000000', status: 'scheduled', assigned_to: 'docA',
      treatment_type: 'בדיקה', scheduled_at: israelDateTimeISO(nextWeekday(2), '17:30'), created_at: new Date().toISOString(),
    }])
    openaiReply = 'בטח! התור שלך קבוע... 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תזכירי לי מתי קבענו תור',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('כבר יש תור קבוע')
    expect(prompt).toContain('17:30')
    expect(prompt).toContain('ד"ר עלא יונס')
    expect(prompt).toContain('בדיקה')
  })

  // קרה בפועל (יוסי, 25/08): תורים שסונכרנו מאופטימה נשמרים לפעמים בלי
  // lead_id (sync-optima/route.ts מקשר ליד רק אם הוא כבר קיים באותו רגע
  // שהתור סונכרן) — חיפוש לפי lead_id בלבד היה מפספס בדיוק את המקרה הזה.
  // "הוא חייב לחפש ליטרלי ביומן לפי שם/טלפון" — מוודאים שהחיפוש עובד גם
  // כשאין קישור ליד בכלל, כל עוד הטלפון תואם
  it('finds the existing appointment by phone even when it has no lead_id linkage at all (Optima-sync gap)', async () => {
    seedBaseline()
    fakeDb.seed('leads', [])
    fakeDb.tables.conversations[0].lead_id = null
    fakeDb.seed('appointments', [{
      id: 'appt1', business_id: 'biz1', lead_id: null, patient_phone: '972500000000', status: 'scheduled', assigned_to: null,
      treatment_type: 'בדיקה', scheduled_at: israelDateTimeISO(nextWeekday(2), '09:00'), created_at: new Date().toISOString(),
    }])
    openaiReply = 'בטח! התור שלך קבוע... 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תזכירי לי מתי קבענו תור',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('כבר יש תור קבוע')
    expect(prompt).toContain('09:00')
  })

  // קרה בפועל (יוסי, 19/08): ד"ר גבי סמל סגר את כל ימי העבודה שלו, וד"ר
  // עלא יונס (הרופא המוסמך היחיד האחר לשיקום פה מלא) גם הוא סגור בכל
  // הימים. נקבע (דרישה עסקית 4): closed:true בכל הימים הוא חסימת-
  // קביעה-אוטומטית מכוונת (מומחה שמתואם ידנית), לא "הטיפול לא ניתן"/"אין
  // תורים" — הבוט לא קובע וגם לא אומר "לא מצאתי תור זמין", אלא דורס
  // דטרמיניסטית להודעה שהבקשה הועברה לנציג לתיאום, ומסמן "ממתין לנציג" לצוות
  it('tells the customer their request was handed off to a rep for manual coordination — never "no appointment"/"unavailable" — when every qualified doctor is closed', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
    fakeDb.tables.businesses[0].settings.services = [{ name: 'שיקום פה מלא', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['שיקום פה מלא'], docB: ['שיקום פה מלא'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '', close: '', closed: true }],
      docB: [{ day: 'שלישי', open: '', close: '', closed: true }],
    }
    fakeDb.seed('profiles', [
      { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
      { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
    ])
    const tuesday = nextWeekday(2)
    openaiReply = `בשמחה! קבענו לך תור לשיקום הפה ביום שלישי ה-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"יוסי","reason":"שיקום הפה"}
APPT:{"date":"${tuesday}","time":"12:00","service":"שיקום הפה"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור לשיקום הפה',
    })
    const json = await res.json()

    // אין קביעה אוטומטית בכלל — לא נשמר תור, ולא מוצג "כישלון" טכני
    expect(json.appointment).toBeUndefined()
    expect(fakeDb.tables.appointments).toHaveLength(0)

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('הועברה')
    expect(sendCall!.body.message).not.toContain('תקלה טכנית')
    expect(sendCall!.body.message).not.toContain('לא מצאתי')
    expect(sendCall!.body.message).not.toContain('לא זמין')

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeTruthy()
    // הליד נוצר לפני שסימנו escalated_at — לא כתיבה עצמאית שעלולה "להיעלם"
    expect(conv!.lead_id).toBeTruthy()
  })

  // ─── דרישה עסקית 2 (ביקורת שלישית): לא מבטיחים "הועברה" בלי אימות ─────────
  it('when the forced-handoff escalation write itself fails: never tells the customer the request was transferred — uses the honest unconfirmed wording instead', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
    fakeDb.tables.businesses[0].settings.services = [{ name: 'שיקום פה מלא', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['שיקום פה מלא'], docB: ['שיקום פה מלא'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '', close: '', closed: true }],
      docB: [{ day: 'שלישי', open: '', close: '', closed: true }],
    }
    fakeDb.seed('profiles', [
      { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
      { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
    ])
    const tuesday = nextWeekday(2)
    openaiReply = `בשמחה! קבענו לך תור לשיקום הפה ביום שלישי ה-${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"דנה","reason":"שיקום הפה"}
APPT:{"date":"${tuesday}","time":"12:00","service":"שיקום הפה"}`
    // פוגע בדיוק בעדכון שמסמן escalated_at, לא בעדכונים אחרים של conversations
    // (נעילת עיבוד, מגדר וכו') שקורים באותה ריצה
    fakeDb.failNextWrite('conversations', 'update', { match: (p: any) => !!p && 'escalated_at' in p })

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור לשיקום הפה',
    })
    const json = await res.json()

    expect(json.appointment).toBeUndefined()
    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).not.toContain('הועברה') // לא הבטחה שקרית
    expect(sendCall!.body.message).not.toContain('לא מצאתי')
    expect(sendCall!.body.message).not.toContain('לא זמין')

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    // הכתיבה נכשלה — escalated_at לא בהכרח נשמר, ובוודאי שלא הובטח ללקוח
    expect(conv!.escalated_at).toBeFalsy()
  })

  // קרה בפועל (יוסי, 19/08, שנית): המודל כתב ב-APPT.service את תחום
  // ההתמחות של הרופא ("כירורגיית פה ולסת") במקום את השירות שהלקוח ביקש —
  // אף שירות מוגדר לא תאם, אף רופא לא שויך, והתור נשמר "בהצלחה" בלי
  // שום עקבות. בודקים שהפרומפט עצמו מנחה עכשיו העתקה מדויקת משם השירות,
  // ושאם זה בכל זאת קורה — יש לוג ברור לגילוי מוקדם
  it('instructs the model to copy the exact configured service name, and flags it in logs if a booking still ends up with no matching service', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tuesday = nextWeekday(2)
    // המודל כותב את תחום ההתמחות במקום את שם השירות המוגדר — בדיוק כמו שקרה בפועל
    openaiReply = `קבענו! ${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"יוסי","reason":"השתלת שיניים"}
APPT:{"date":"${tuesday}","time":"12:00","service":"כירורגיית פה ולסת"}`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה השתלת שיניים',
    })
    const json = await res.json()

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('העתק בדיוק')

    // תודות לתיקון בסינונים הכללי (SERVICE_SYNONYM_GROUPS), הביטוי הזה
    // כן נתפס עכשיו וגם משויך רופא נכון — הלוג לא אמור לדלוק במקרה הזה בפועל
    expect(json.appointment?.ok).toBe(true)
    expect(fakeDb.tables.appointments[0]?.assigned_to).toBe('docA')
    errorSpy.mockRestore()
  })

  it('logs a reliability flag when a booking has no matching doctor despite the business having doctor↔service mapping configured', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tuesday = nextWeekday(2)
    // ניסוח שלא תואם לשום דבר מוכר — כדי לבדוק את רשת הביטחון עצמה, לא ההתאמה
    openaiReply = `קבענו! ${tuesday.split('-').reverse().join('.')} בשעה 12:00 😊
LEAD:{"name":"יוסי","reason":"טיפול כלשהו"}
APPT:{"date":"${tuesday}","time":"12:00","service":"בדיקה כללית לא ידועה xyz123"}`

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור',
    })

    const flagCall = errorSpy.mock.calls.find(c => String(c[0]).includes('RELIABILITY FLAG'))
    expect(flagCall).toBeTruthy()
    errorSpy.mockRestore()
  })

  // קרה בפועל (יוסי, 19/08): לקוח עם תור עתידי אמיתי שאל "למי?" (לא קשור
  // לתאריך כלל), והמודל הזה אישור-תור ישן משיחה קודמת באותו thread —
  // ה-fallback (extractApptFromText) כמעט הזיז בשקט את התור האמיתי
  // לתאריך שגוי. בודקים שהתור המקורי נשאר בדיוק כמו שהיה
  it('does not silently reschedule an existing appointment when the model echoes a stale confirmation in reply to an unrelated question', async () => {
    seedBaseline()
    const sunday = nextWeekday(0)
    fakeDb.tables.appointments = [{
      id: 'existing-appt', business_id: 'biz1', lead_id: 'leads-1', status: 'scheduled',
      scheduled_at: israelDateTimeISO(sunday, '10:00'), duration_minutes: 60, assigned_to: null,
    }]
    fakeDb.tables.leads = [{ id: 'leads-1', business_id: 'biz1', phone: '972500000000', name: 'יוסי' }]
    fakeDb.tables.conversations[0].lead_id = 'leads-1'
    // המודל "נזכר" ומשכפל אישור-תור ישן לתאריך אחר לגמרי, בתגובה לשאלה שלא קשורה לתאריך
    openaiReply = '✅ קבעתי לך תור ליום יום רביעי 26.08.2026 בשעה 10:00.\nהכתובת: רח\' פתח תקווה 6, בניין החלוצים, נתניה'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'למי',
    })

    // מספר התורים לא השתנה, והתור הקיים לא זז מהתאריך המקורי שלו
    expect(fakeDb.tables.appointments).toHaveLength(1)
    expect(fakeDb.tables.appointments[0].scheduled_at).toBe(israelDateTimeISO(sunday, '10:00'))
  })

  it('still honors a genuine fallback confirmation when the customer\'s own message shows real scheduling intent', async () => {
    seedBaseline()
    const tuesday = nextWeekday(2)
    openaiReply = `נפלא! 🙌 תורך לעקירת שן בינה מאושר ל-${tuesday.split('-').reverse().join('.')} 10:00. נראה לנו! 😊`

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: '10:00 מתאים',
    })
    const json = await res.json()
    expect(json.appointment?.ok).toBe(true)
    expect(fakeDb.tables.appointments).toHaveLength(1)
  })

  // קרה בפועל (24/08, אוריין, לקוח אמיתי): הבוט הציע "יש לנו תור פנוי ביום
  // שני הקרוב, 30.08.2026, בשעה 10:00" — הרופא היחיד ל"סתימה" לא עובד באותו
  // יום. הלקוח ביקש "תקבע לי" וקיבל מיד אחרי זה "אין תורים פנויים" — סתירה
  // מוחלטת. בודקים שההצעה הכוזבת עצמה נבלמת, לפני שהיא בכלל נשלחת
  it('does not offer a specific date/time when no qualified doctor is actually available that day', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'טיפולים משמרים', active: true, duration: '30' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['טיפולים משמרים'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [
        { day: 'ראשון', open: '', close: '', closed: true },
        { day: 'שני', open: '', close: '', closed: true },
        { day: 'שלישי', open: '09:00', close: '16:00', closed: false },
        { day: 'רביעי', open: '09:00', close: '16:00', closed: false },
      ],
    }
    // 30.08.2026 הוא יום ראשון בפועל — הרופא היחיד ל"סתימה" סגור
    openaiReply = 'יש לנו תור פנוי ביום שני הקרוב, 30.08.2026, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"סתימה"}'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שני',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).not.toContain('תור פנוי')
    expect(sendCall!.body.message).not.toContain('30.08.2026')
    // יוסי (24/08): אותו נוסח בדיוק חייב לצאת גם כשההצעה עצמה נבלמת וגם
    // כשהקביעה בפועל נדחית — שיח אחיד, לא שני ניסוחים שונים ל"אותו דבר"
    expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeTruthy()
  })

  // (יוסי, 01/09, FIX 2): מאז ה-hardening, ההצעה שנשלחת בפועל היא תמיד
  // SAFE_EXACT_SLOT_RESPONSE הדטרמיניסטית (פורמט DD.MM, ר' buildSafeExactSlotResponse) —
  // לא הטקסט המקורי של ה-LLM (שכלל DD.MM.YYYY מלא). עדיין "הצעה אמיתית",
  // רק בניסוח קבוע ולא בניסוח החופשי שהמודל כתב
  it('still sends a genuine offer when a qualified doctor really is available that day', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'טיפולים משמרים', active: true, duration: '30' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['טיפולים משמרים'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
    }
    const tuesday = nextWeekday(2) // יום שלישי הקרוב — הרופא כן עובד
    const tuesdayDMY = tuesday.split('-').reverse().join('.')
    const tuesdayDM = tuesdayDMY.split('.').slice(0, 2).join('.')
    openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesdayDMY}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"סתימה"}`

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain(tuesdayDM)
    expect(sendCall!.body.message).toContain('10:00')
    expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
  })

  // ─── בדיקת זמינות אמיתית בשעה מדויקת, לא רק ביום (יוסי, 31/08) ────────────
  describe('offer-grounding also checks exact time-slot collision, not just day-of-week', () => {
    it('does NOT send "יש תור ב-10:00" when 10:00 is already booked for the sole qualified doctor — falls back to the existing human-handoff message', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'טיפולים משמרים', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['טיפולים משמרים'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2) // יום שלישי בפועל
      fakeDb.seed('appointments', [{
        id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח אחר', patient_phone: '972500000001',
        assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30,
      }])
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"סתימה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('10:00')
      // אותו נוסח קבוע, אותה התנהגות הסלמה — לא flow חלופי, לא שעה שהומצאה
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    it('DOES send the offer when 10:00 is genuinely free for the qualified doctor', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'טיפולים משמרים', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['טיפולים משמרים'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2)
      // תור קיים באותו יום, אבל בשעה אחרת שלא חופפת ל-10:00 — לא אמור לחסום
      fakeDb.seed('appointments', [{
        id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח אחר', patient_phone: '972500000001',
        assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '13:00'), duration_minutes: 30,
      }])
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"סתימה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00')
    })

    it('lets the offer through using the doctor who is actually free, when doctor A is busy at that time but doctor B qualifies and is free', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
        docB: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2)
      fakeDb.seed('appointments', [{
        id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח אחר', patient_phone: '972500000001',
        assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30,
      }])
      // ההצעה לא נוקבת בשם רופא ספציפי — לא סותרת את הבדיקה, גם אם A עסוק
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00')
    })

    it('does not invent an alternative time when no qualified doctor is free at all — falls back to the existing human-handoff, not a made-up slot', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
        docB: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2)
      fakeDb.seed('appointments', [
        { id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח 1', patient_phone: '972500000001', assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30 },
        { id: 'existing2', business_id: 'biz1', lead_id: null, patient_name: 'לקוח 2', patient_phone: '972500000002', assigned_to: 'docB', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30 },
      ])
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })
  })

  // ─── תיקון ממוקד: LLM מזכיר רופא שגוי בהצעה, כשיש רופא אחר מוסמך+פנוי ──────
  // (יוסי, 31/08) — ההבחנה הקריטית: האם הלקוח עצמו ביקש רופא ספציפי
  // (בהודעה נכנסת), או שה-LLM הזכיר/בחר את השם מיוזמתו
  describe('offer-grounding corrects an LLM-mentioned wrong doctor name, but never silently swaps a doctor the customer explicitly asked for', () => {
    function seedTwoDoctorsOneBusy() {
      fakeDb.seed('profiles', [
        { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
        { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
      ])
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
        docB: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2)
      fakeDb.seed('appointments', [
        { id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח אחר', patient_phone: '972500000001', assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30 },
      ])
      return tuesday
    }

    // Regression test 1
    it('offers doctor B (the one actually free) instead of escalating, when the customer never asked for a specific doctor and the LLM just happened to mention the busy one', async () => {
      seedBaseline()
      const tuesday = seedTwoDoctorsOneBusy()
      // הלקוח לא מזכיר שום שם רופא בעצמו
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00 עם ד"ר גבי סמל. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      // התור עדיין מוצע (לא נחסם/מוסלם) — עם השם המתוקן
      expect(sendCall!.body.message).toContain('10:00')
      expect(sendCall!.body.message).toContain('ד"ר עלא יונס')
      expect(sendCall!.body.message).not.toContain('ד"ר גבי סמל')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // Regression test 2
    it('does NOT silently substitute doctor B when the customer explicitly asked for doctor A by name — falls back to the existing escalation path', async () => {
      seedBaseline()
      const tuesday = seedTwoDoctorsOneBusy()
      // הלקוח מבקש במפורש את ד"ר גבי סמל (docA) בעצמו, בהודעה נכנסת
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'אני רוצה תור אצל ד"ר גבי סמל להשתלות ביום שלישי ב-10:00',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00 עם ד"ר גבי סמל. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אני רוצה תור אצל ד"ר גבי סמל להשתלות ביום שלישי ב-10:00',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      // לא הוחלף בשקט לד"ר עלא יונס — מסלול ההעברה לנציג הקיים
      expect(sendCall!.body.message).not.toContain('ד"ר עלא יונס')
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // Regression test 3
    it('sends the offer through untouched when the LLM does not mention any doctor name at all', async () => {
      seedBaseline()
      const tuesday = seedTwoDoctorsOneBusy()
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // Regression test 4
    it('escalates to a human rep exactly as before when no qualified doctor is free at all, regardless of which name the LLM mentioned', async () => {
      seedBaseline()
      fakeDb.seed('profiles', [
        { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
        { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
      ])
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
        docB: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
      const tuesday = nextWeekday(2)
      fakeDb.seed('appointments', [
        { id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח 1', patient_phone: '972500000001', assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30 },
        { id: 'existing2', business_id: 'biz1', lead_id: null, patient_name: 'לקוח 2', patient_phone: '972500000002', assigned_to: 'docB', status: 'scheduled', scheduled_at: israelDateTimeISO(tuesday, '10:00'), duration_minutes: 30 },
      ])
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00 עם ד"ר גבי סמל. האם זה מתאים לך? 😊\nLEAD:{"reason":"השתלות"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'רוצה תור להשתלות ביום שלישי ב-10:00',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })
  })

  // ─── resolveActiveService — fail-closed, לא fail-open, כשלא ברור מה נדרש ───
  // (יוסי, 31/08, מקרה ד"ר גבי סמל האמיתי בפרודקשן) — service לא ידוע חייב
  // לחסום את ההצעה, לא לתת לה לעבור בלי אימות
  describe('service resolution before an offer is grounded — fails closed, never falls back to stale lead.treatment_type', () => {
    function seedGabiAndYounesAllClosedExceptTuesday() {
      fakeDb.seed('profiles', [
        { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
        { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
      ])
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
        docB: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
      }
    }

    // Regression test 1
    it('resolves the service from the current message, and only a qualified+working+free doctor can be offered', async () => {
      seedBaseline()
      seedGabiAndYounesAllClosedExceptTuesday()
      const tuesday = nextWeekday(2)
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'אני רוצה השתלה ביום שלישי',
      }]
      // בלי תגית LEAD בכלל — resolveActiveService חייב להסתמך על עדיפות 2
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אני רוצה השתלה ביום שלישי',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00') // שני הרופאים עובדים שלישי — הצעה תקינה
    })

    // Regression test 2
    it('still resolves the service from earlier context when the current turn is just "כן" and the LEAD tag has no reason', async () => {
      seedBaseline()
      seedGabiAndYounesAllClosedExceptTuesday()
      const tuesday = nextWeekday(2)
      fakeDb.tables.messages = [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact', content: 'אני רוצה השתלה', created_at: '2026-08-31T10:00:00.000Z' },
        { id: 'm2', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', sender_type: 'ai', content: 'יום שלישי מתאים?', created_at: '2026-08-31T10:00:05.000Z' },
        { id: 'm3', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact', content: 'כן', created_at: '2026-08-31T10:00:10.000Z' },
      ]
      // אין "השתלה" בהודעה הנוכחית, ואין תגית LEAD — השירות חייב להיפתר מההיסטוריה
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'כן',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00')
    })

    // Regression test 3
    it('fails closed (escalates) when the service cannot be identified from the reason tag or any recent customer message', async () => {
      seedBaseline()
      seedGabiAndYounesAllClosedExceptTuesday()
      const tuesday = nextWeekday(2)
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'מתי אתם פתוחים',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי אתם פתוחים',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // Regression test 4
    it('uses the service from the current conversation, not a stale lead.treatment_type from an unrelated earlier topic', async () => {
      seedBaseline()
      seedGabiAndYounesAllClosedExceptTuesday()
      const tuesday = nextWeekday(2)
      fakeDb.tables.conversations[0].lead_id = 'lead1'
      fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', name: 'לקוח', status: 'in_progress', treatment_type: 'הלבנת שיניים' }])
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'אני רוצה השתלה ביום שלישי',
      }]
      openaiReply = `יש לנו תור פנוי ביום שלישי הקרוב, ${tuesday.split('-').reverse().join('.')}, בשעה 10:00. האם זה מתאים לך? 😊`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'אני רוצה השתלה ביום שלישי',
      })

      // אם המערכת הייתה נופלת בטעות ל-treatment_type הישן ("הלבנת שיניים"),
      // לא היה נמצא אף רופא מוסמך (אף אחד לא מוסמך להלבנה בבדיקה הזו) —
      // ההצעה הייתה נחסמת. היא לא נחסמת, כי השירות הפעיל הוא השתלות
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('10:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // Regression test 5 — המקרה האמיתי מהפרודקשן
    it('real-world case: Dr. Gabi Samel with every day closed must never be offered for השתלות on 31.08.2026 10:00', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
      fakeDb.seed('profiles', [
        { id: 'docGabi', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
      ])
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '30' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docGabi: ['השתלות', 'שיקום פה מלא'] }
      // בדיוק כמו ב-DB האמיתי: כל 7 הימים סגורים
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docGabi: [
          { day: 'ראשון', open: '09:00', close: '17:00', closed: true },
          { day: 'שני', open: '09:00', close: '17:00', closed: true },
          { day: 'שלישי', open: '09:00', close: '17:00', closed: true },
          { day: 'רביעי', open: '09:00', close: '17:00', closed: true },
          { day: 'חמישי', open: '09:00', close: '17:00', closed: true },
          { day: 'שישי', open: '09:00', close: '13:00', closed: true },
          { day: 'שבת', open: '', close: '', closed: true },
        ],
      }
      fakeDb.tables.messages = [{
        id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
        content: 'יוסי, מכפר סבא. אני רוצה לקבוע תור להשתלה ביום שני בבוקר',
      }]
      // אותה הודעה בדיוק כמו בפרודקשן — בלי תגית LEAD
      openaiReply = 'תודה יוסי! 🌸\n\nד"ר גבי סמל מבצע את ההשתלות, והוא זמין ביום שני 31.08.2026 בשעה 10:00.\n\nהאם זה מתאים לך?'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'יוסי, מכפר סבא. אני רוצה לקבוע תור להשתלה ביום שני בבוקר',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('31.08.2026')
      expect(sendCall!.body.message).not.toContain('10:00')
      // דרישה עסקית 4 (מאוחר יותר מהתיקון המקורי): ד"ר גבי סמל סגור/ה בכל
      // הימים — closed:true הוא חסימת-קביעה-אוטומטית מכוונת (מומחה שמתואם
      // ידנית), לא "אין תור זמין". התשובה עברה מ-NO_AVAILABILITY_MESSAGE
      // הכללי להודעת handoff דטרמיניסטית ("מועבר לנציג לתיאום"), לא
      // "לא מצאתי"/"לא זמין"
      expect(sendCall!.body.message).not.toContain('לא מצאתי')
      expect(sendCall!.body.message).not.toContain('לא זמין')
      expect(sendCall!.body.message).toContain('הועברה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })
  })

  // ─── FIND AVAILABLE SLOTS — "מתי פנוי?"/"מה יש בשלישי?" (יוסי, 01/09) ─────
  // עד כה המערכת ידעה רק לאמת שעה שכבר ניתנה, לא לענות בעצמה על שאלת
  // זמינות כללית — ראה מפרט מלא ב-findAvailableSlots (botAppointments.ts)
  describe('FIND AVAILABLE SLOTS — real available-slot listing computed before generation, grounded after it', () => {
    // תרחישים G ו-J: שניהם סומכים על "שלישי" שנפתר ל**היום** (הלקוח/הבוט
    // לא נותנים תאריך מפורש, וresolveActiveRequestedDate פותר שם-יום שחל
    // גם היום ל-"היום עצמו", בכוונה — ר' nextDateForWeekday). חלון 09:00-
    // 11:00/09:00-10:00 קבוע נכשל אם הבדיקה רצה אחה"צ (אחרי תיקון
    // meetsMinLeadTime, בצדק — שעות שעברו היום כבר לא מוחזרות). מקפיאים
    // שעון מקומי (Date בלבד — לא setTimeout, כדי לא לתקוע את ההשהיות
    // המלאכותיות בתוך handleAiRespond) ל-06:00 בבוקר יום שלישי מאומת,
    // רק לשתי הבדיקות האלה — לא גלובלי, לא ל-H/I שלא תלויות ב"היום"
    describe('with a frozen local clock (today must genuinely be Tuesday morning, 09:00-11:00 still ahead)', () => {
      const FROZEN_TUESDAY_MORNING = '2026-01-06T04:00:00.000Z' // = 06:00 שעון ישראל, יום שלישי מאומת
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(FROZEN_TUESDAY_MORNING))
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      // תרחיש G: "תרשום לי מתי פנוי" בלי לחזור על היום — היום כבר "פעיל"
      // בשיחה כי הבוט עצמו שאל עליו קודם
      it('G — uses the day already active in the conversation (bot asked about it) when the customer just says "תרשום לי מתי פנוי"', async () => {
        seedBaseline()
        fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
        fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
        fakeDb.tables.businesses[0].settings.employee_schedules = {
          docA: [{ day: 'שלישי', open: '09:00', close: '11:00', closed: false }],
        }
        fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
        fakeDb.seed('messages', [
          { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה', sender_type: 'contact' },
          { id: 'm2', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', content: 'מה מתאים לך ביום שלישי?', sender_type: 'ai' },
        ])
        openaiReply = 'בטח! יש לנו פנוי ב-09:00 😊\nLEAD:{"reason":"הלבנה"}'

        await callAiRespond({
          conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תרשום לי מתי פנוי',
        })

        // הזמינות האמיתית חושבה **לפני** הגנרציה והוזרקה לפרומפט עצמו
        const prompt = openaiCalls[0]?.systemPrompt || ''
        expect(prompt).toContain('זמינות אמיתית')
        expect(prompt).toContain('09:00')

        const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
        expect(sendCall!.body.message).toContain('09:00')
        const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
        expect(conv!.escalated_at).toBeFalsy()
      })

      // תרחיש J: ה-LLM "משפר" ומוסיף שעה שלא הייתה ברשימה האמיתית שהוזרקה
      // לו. (יוסי, 01/09, אחרי מקרה פרודקשן): כשיש slots אמיתיים, כשל
      // ניסוח של ה-LLM לא הופך יותר ל-"אין זמינות"/הסלמה — SAFE_SLOT_RESPONSE
      it('J — a time the model invents beyond the real computed slots list is never sent — SAFE_SLOT_RESPONSE with the real slot instead, no escalation', async () => {
        seedBaseline()
        fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
        fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
        fakeDb.tables.businesses[0].settings.employee_schedules = {
          docA: [{ day: 'שלישי', open: '09:00', close: '10:00', closed: false }], // רק 09:00 אפשרי (60 דק')
        }
        fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
        fakeDb.seed('messages', [
          { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה ביום שלישי', sender_type: 'contact' },
        ])
        // 14:30 מומצאת — לא הייתה ברשימת השעות האמיתיות שהוזרקה לפרומפט
        openaiReply = 'יש לנו פנוי ב-09:00 וגם ב-14:30 😊\nLEAD:{"reason":"הלבנה"}'

        await callAiRespond({
          conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
        })

        const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
        expect(sendCall!.body.message).not.toContain('14:30')
        expect(sendCall!.body.message).toContain('09:00') // ה-slot האמיתי כן מוצג
        expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
        const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
        expect(conv!.escalated_at).toBeFalsy() // יש זמינות אמיתית — אסור להסלים בגללה
      })
    })

    // תרחיש H: "ברביעי פנוי?" — שם יום ישיר, פותר לתאריך קונקרטי (רביעי הקרוב)
    it('H — "ברביעי פנוי?" resolves the weekday name to a concrete date and returns real slots for it', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'רביעי', open: '09:00', close: '11:00', closed: false }],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה', sender_type: 'contact' },
      ])
      openaiReply = 'בהחלט! יש לנו פנוי ב-09:00 😊\nLEAD:{"reason":"הלבנה"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'ברביעי פנוי?',
      })

      const wednesday = nextWeekday(3)
      const [dy, dm, dd] = wednesday.split('-')
      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).toContain(`${dd}.${dm}.${dy}`)
      expect(prompt).toContain('09:00')

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // תרחיש I: אין זמינות אמיתית בכלל, אבל כן יש רופא/ה מוסמכ/ת עם לוח פתוח
    // (busy, לא fully_blocked) — לא ממציאים שעה, נשארים על מנגנון ההסלמה
    // הקיים (אותו ניסוח קבוע, אותה תגית escalated_at)
    it('I — a qualified doctor exists with an open calendar but no real slot in the window: falls back to the existing escalation message, no invented time', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        // רביעי פתוח (לא fully_blocked) — אבל הלקוח שאל על שלישי, שבו
        // הרופא/ה סגור/ה, ולכן אין slot אמיתי באותו יום ספציפי שנבדק
        docA: [{ day: 'שלישי', open: '', close: '', closed: true }, { day: 'רביעי', open: '09:00', close: '17:00', closed: false }],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה ביום שלישי', sender_type: 'contact' },
      ])
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"הלבנה"}\nESCALATE:["אין זמינות"]'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
      })

      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).toContain('לא נמצאה זמינות אמיתית')

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // דרישה עסקית 4: כשהרופא/ה המוסמכ/ת היחיד/ה סגור/ה בכל הימים (fully_blocked),
    // לא מציגים שעות ולא אומרים "לא מצאתי תור זמין" — מעבירים לנציג לתיאום
    it('fully_blocked doctor (closed every day) for the requested service: never shows hours, never says "no appointment found" — hands off to a rep instead', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '', close: '', closed: true }],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה ביום שלישי', sender_type: 'contact' },
      ])
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
      })

      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).not.toContain('לא נמצאה זמינות אמיתית')
      expect(prompt).not.toContain('זמינות אמיתית ב-')

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא מצאתי')
      expect(sendCall!.body.message).not.toContain('לא זמין')
      expect(sendCall!.body.message).toContain('הועברה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // (multi-tenant isolation, ביקורת רביעית): אותו תרחיש בדיוק, בלי הדגל —
    // ההתנהגות חייבת לחזור להיות בדיוק כמו לפני כל תכונת ה-forced-handoff:
    // findAvailableSlots הרגילה (שלא נגעתי בה) עדיין מזהה שאין שעות פנויות
    // (הרופא/ה סגור/ה), והבוט נופל למסלול ה-NO_AVAILABILITY_MESSAGE הישן —
    // לא ל-buildHandoffToRepResponse החדש
    it('the same fully_blocked scenario WITHOUT strict_service_doctor_booking: falls back to the old NO_AVAILABILITY_MESSAGE route exactly as before, not the new deterministic handoff', async () => {
      seedBaseline() // בכוונה בלי strict_service_doctor_booking
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'שלישי', open: '', close: '', closed: true }],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנה ביום שלישי', sender_type: 'contact' },
      ])
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"הלבנה"}\nESCALATE:["אין זמינות"]'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
      })

      // ההתנהגות הישנה: findAvailableSlots עדיין רצה כרגיל ומזריקה את
      // ההנחיה הרגילה לפרומפט (בניגוד לתרחיש ה-strict, ששם היא לא רצה בכלל)
      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).toContain('לא נמצאה זמינות אמיתית')

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      expect(sendCall!.body.message).not.toContain('הועברה')
    })

  })

  // ─── GENERAL NEXT AVAILABLE — "מתי יש לכם?"/"מתי פנוי?" בלי יום ספציפי ────
  // (יוסי, 01/09): קרה בפועל — לקוח ביקש "מתי יש לכם?" בלי לתת יום, והבוט
  // נפל תמיד לברירת המחדל ("לא מצאתי תור זמין") גם כשבפועל הייתה זמינות.
  // סורק 14 יום קדימה (findNextAvailableSlots, עוטפת את findAvailableSlots
  // הקיימת ללא שינוי בה) ומזריק תוצאה אמיתית מרובת-תאריכים, עם עיגון date+
  // time+doctor נפרד (לא רק שעה בודדת — אותה שעה יכולה להיות אמיתית ביום
  // אחד ומומצאת באחר)
  describe('GENERAL NEXT AVAILABLE — no specific day given, scans forward for the first real slots', () => {
    function allWeekSchedule(open: string, close: string): { day: string; open: string; close: string; closed: boolean }[] {
      return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => ({ day, open, close, closed: false }))
    }
    function allWeekClosed(): { day: string; open: string; close: string; closed: boolean }[] {
      return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => ({ day, open: '', close: '', closed: true }))
    }

    // 1. "אני צריך השתלה, מתי יש?" — בלי תאריך, סריקה קדימה מחזירה slots אמיתיים
    it('1 — "אני צריך השתלה, מתי יש?" with no specific date returns real slots from the forward scan', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '11:00') }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני צריך השתלה', sender_type: 'contact' },
      ])
      openaiReply = 'בטח! יש לנו כמה אפשרויות פנויות 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      // הזמינות חושבה מראש והוזרקה לפרומפט, עם תאריך מלא (לא יום בודד ידוע)
      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).toContain('התורים הפנויים הקרובים ביותר')
      expect(prompt).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 4. אין שום slot בכל טווח 14 הימים, אבל הרופא/ה כן עובד/ת יום אחד
    // בשבוע (busy, לא fully_blocked כי יש יום פתוח) — מסלול ההסלמה הקיים
    it('4 — a qualified doctor with an open calendar has no slot anywhere in the 14-day window: falls back to the existing escalation route, exactly as before', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
      // יום אחד פתוח (לא fully_blocked) — אבל כל השעות בו כבר תפוסות
      // (appointments existing) כך שבפועל אין slot פנוי בכל 14 הימים
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [{ day: 'ראשון', open: '09:00', close: '10:00', closed: false }],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני צריך השתלה', sender_type: 'contact' },
      ])
      const sunday1 = nextWeekday(0)
      const sunday2 = nextWeekday(0, sunday1)
      fakeDb.seed('appointments', [
        { id: 'a1', business_id: 'biz1', assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(sunday1, '09:00'), duration_minutes: 60 },
        { id: 'a2', business_id: 'biz1', assigned_to: 'docA', status: 'scheduled', scheduled_at: israelDateTimeISO(sunday2, '09:00'), duration_minutes: 60 },
      ])
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"השתלות"}\nESCALATE:["אין זמינות"]'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).toContain('לא נמצאה זמינות אמיתית')
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // דרישה עסקית 4: fully_blocked (סגור/ה בכל 7 הימים) בזמינות כללית —
    // לא מציגים "אין תור זמין", מעבירים לנציג לתיאום
    it('fully_blocked doctor (closed every day) in a general-availability search: hands off to a rep, never shows/claims no availability in the usual wording', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekClosed() }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני צריך השתלה', sender_type: 'contact' },
      ])
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const prompt = openaiCalls[0]?.systemPrompt || ''
      expect(prompt).not.toContain('לא נמצאה זמינות אמיתית')
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא מצאתי')
      expect(sendCall!.body.message).not.toContain('לא זמין')
      expect(sendCall!.body.message).toContain('הועברה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // 7. ה-LLM מוסיף תאריך/שעה שלא הוחזרו מהסריקה האמיתית. (יוסי, 01/09,
    // אחרי מקרה פרודקשן): SAFE_SLOT_RESPONSE במקום — לא NO_AVAILABILITY,
    // כי יש בפועל זמינות אמיתית
    it('7 — a date/time the model invents beyond the real next-available list is never sent — SAFE_SLOT_RESPONSE with the real slots instead, no escalation', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '10:00') } // slot יחיד/יום
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני צריך השתלה', sender_type: 'contact' },
      ])
      // 01.01.2099 מומצא — לעולם לא ברשימה האמיתית שחושבה
      openaiReply = 'יש לנו פנוי ב-01.01.2099 09:00 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('01.01.2099')
      expect(sendCall!.body.message).toContain('09:00') // ה-slots האמיתיים כן מוצגים
      expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy() // יש זמינות אמיתית — אסור להסלים בגללה
    })

    // הלקוח ביקש רופא מסוים, בלי יום ספציפי — כל האפשרויות שייכות רק לו/ה
    it('restricts the general scan to the explicitly-requested doctor, never silently substituting another', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: allWeekSchedule('09:00', '11:00'), docB: allWeekSchedule('09:00', '11:00'),
      }
      fakeDb.seed('profiles', [
        { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
        { id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
      ])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה השתלה אצל ד"ר עלא יונס, מתי יש לכם?', sender_type: 'contact' },
      ])
      openaiReply = 'בטח! יש לנו כמה אפשרויות אצל ד"ר עלא יונס 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      // "שיוך שירותים לרופאים" מציג את שני הרופאים תמיד (מידע כללי) — הבדיקה
      // הרלוונטית היא שורת ה-slots האמיתית עצמה, לא הפרומפט כולו
      const prompt = openaiCalls[0]?.systemPrompt || ''
      const slotsLine = prompt.split('\n').find(l => l.startsWith('התורים הפנויים הקרובים ביותר'))
      expect(slotsLine).toContain('עלא יונס')
      expect(slotsLine).not.toContain('גבי סמל')
    })
  })

  // ─── SAFE_SLOT_RESPONSE — INVARIANT: real slots never become "no availability" ──
  // (יוסי, 01/09, מקרה פרודקשן אמיתי): service="הלבנה", findNextAvailableSlots
  // מצאה בפועל 4 slots אמיתיים (01.09 11:00, 01.09 15:00, 02.09 13:00,
  // 02.09 14:00), ובכל זאת הלקוח קיבל "לא מצאתי תור זמין" והועבר לנציג.
  // מכאן: IF computedSlots.length>0 → לעולם לא NO_AVAILABILITY/הסלמה,
  // רק SAFE_SLOT_RESPONSE הבנוי ישירות מהנתונים האמיתיים
  describe('SAFE_SLOT_RESPONSE — real slots never become "no availability", regardless of how badly the model phrases its own answer', () => {
    function allWeekSchedule(open: string, close: string): { day: string; open: string; close: string; closed: boolean }[] {
      return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => ({ day, open, close, closed: false }))
    }
    function allWeekClosed(): { day: string; open: string; close: string; closed: boolean }[] {
      return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => ({ day, open: '', close: '', closed: true }))
    }
    function seedGeneralInquiry() {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['השתלות'] }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני צריך השתלה', sender_type: 'contact' },
      ])
    }

    // 1. ה-LLM אומר "לא מצאתי תור זמין" כשיש בפועל 4 slots אמיתיים
    it('1 — the model says "no availability" while real slots exist: SAFE_SLOT_RESPONSE is sent instead, no escalation', async () => {
      seedGeneralInquiry()
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '11:00') }
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      expect(sendCall!.body.message).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 2. ה-LLM ממציא שעה נוספת שלא קיימת (מכוסה גם ב-tests הקיימים 7/J,
    // מוחזר כאן במפורש לפי מספור הבדיקות שאושר)
    it('2 — the model invents an extra time that does not exist: SAFE_SLOT_RESPONSE, no escalation', async () => {
      seedGeneralInquiry()
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '10:00') } // slot יחיד/יום
      openaiReply = 'יש לנו פנוי ב-09:00 וגם ב-14:30 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('14:30')
      expect(sendCall!.body.message).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 3. ה-LLM כותב את השעה בפורמט/ניסוח שה-validator לא מצליח לפרש
    // (שם יום בלבד, בלי תאריך מספרי — בדיוק כמו המקרה האמיתי בפרודקשן)
    it('3 — the model uses a format the validator cannot parse (day name only, no numeric date): SAFE_SLOT_RESPONSE, not NO_AVAILABILITY_MESSAGE, no escalation', async () => {
      seedGeneralInquiry()
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '11:00') }
      // אין שום DD.MM.YYYY בתשובה — extractAllDateTimePairsInText לא תמצא זוגות
      openaiReply = 'יש לנו תור פנוי ביום שלישי בשעה 09:00, מתאים לך? 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      expect(sendCall!.body.message).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 4. ה-LLM מזכיר רופא שאינו ברשימת הרופאים של ה-slots
    it('4 — the model mentions a doctor not among the real slots: SAFE_SLOT_RESPONSE with the real data only, no escalation', async () => {
      seedGeneralInquiry()
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekSchedule('09:00', '11:00') }
      fakeDb.seed('profiles', [
        { id: 'docA', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
        { id: 'docC', full_name: 'ד"ר לא-מוסמך', business_id: 'biz1' },
      ])
      openaiReply = 'יש לנו פנוי ב-09:00 אצל ד"ר לא-מוסמך 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא-מוסמך')
      expect(sendCall!.body.message).toContain('09:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 5. computedSlots ריק — ההתנהגות הקיימת נשמרת בדיוק
    // דרישה עסקית 4: fully_blocked (allWeekClosed) — לא "אין תור זמין",
    // מעבירים לנציג לתיאום (ראה גם התיאור המלא ב-getServiceDoctorAvailabilityStatus)
    it('5 — fully_blocked doctor (closed every day): hands off to a rep, never claims "no availability" in the usual wording', async () => {
      seedGeneralInquiry()
      fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
      fakeDb.tables.businesses[0].settings.employee_schedules = { docA: allWeekClosed() }
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא מצאתי')
      expect(sendCall!.body.message).not.toContain('לא זמין')
      expect(sendCall!.body.message).toContain('הועברה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // 6. המקרה האמיתי מפרודקשן: service=הלבנה, 4 slots אמיתיים
    // (01.09 11:00, 01.09 15:00, 02.09 13:00, 02.09 14:00)
    it('6 — real production case replay: 4 real slots for הלבנה — customer gets the real options, never "no availability", never escalation', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docA: [
          { day: 'שלישי', open: '10:00', close: '16:00', closed: false },
          { day: 'רביעי', open: '10:00', close: '16:00', closed: false },
        ],
      }
      fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר מסאוורה', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'בעצם אני צריך הלבנה שיניים יש תורים פנויים?', sender_type: 'contact' },
      ])
      // בדיוק כמו בפרודקשן: המודל ענה שאין זמינות, למרות שהיו slots אמיתיים
      openaiReply = 'לצערי, לא מצאתי תור זמין כרגע. אני אעביר את הבקשה לנציג שיחזור אליך בהקדם עם פרטים נוספים.\nLEAD:{"reason":"הלבנה"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'בעצם אני צריך הלבנה שיניים יש תורים פנויים?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא מצאתי תור זמין')
      expect(sendCall!.body.message).toContain('ד"ר מסאוורה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })
  })

  // ─── STAGE 1A — CONTEXT-AWARE AVAILABILITY DETECTION ────────────────────
  // (יוסי, 01/09, מקרה פרודקשן אמיתי): הבוט שאל "יש לך העדפה לתאריך או
  // שעה לפגישה עם ד"ר עלא יונס?", הלקוח ענה "מתי אפשר?" — looksLikeAvailabilityInquiry
  // לא זיהתה, כל הבלוק דילג, וה-LLM ענה בלי grounding בכלל (ראה השיחה
  // האמיתית: "יש לנו מספר תורים פנויים... יום שלישי בשעה 11:00" — בלי
  // תאריך, בלי שום בדיקה אמיתית מאחורי זה). כאן: זיהוי הקשרי לפי הודעת
  // הבוט האחרונה, לא עוד ביטוי אצל הלקוח
  describe('STAGE 1A/1B — context-aware availability detection + full-date SAFE_SLOT_RESPONSE (real production case)', () => {
    function allWeekSchedule(open: string, close: string): { day: string; open: string; close: string; closed: boolean }[] {
      return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => ({ day, open, close, closed: false }))
    }
    function seedSchedulingContext() {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = { docB: allWeekSchedule('09:00', '11:00') }
      fakeDb.seed('profiles', [{ id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להשתלה אצל ד"ר עלא יונס', sender_type: 'contact' },
        { id: 'm2', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', content: 'תודה! יש לך העדפה לתאריך או שעה לפגישה עם ד"ר עלא יונס?', sender_type: 'ai' },
      ])
    }
    function ranAvailabilityFlow(): boolean {
      const prompt = openaiCalls[0]?.systemPrompt || ''
      return prompt.includes('התורים הפנויים הקרובים ביותר') || prompt.includes('זמינות אמיתית')
    }

    // A-E: תגובות עמומות/קצרות אחרי שהבוט שאל על תאריך/שעה — כולן צריכות
    // להיכנס למסלול availability, בלי אף אחת מהן ברשימת AVAILABILITY_INQUIRY_PHRASES
    const vagueContinuations: [string, string][] = [
      ['A', 'מתי אפשר?'],
      ['B', 'מה הכי קרוב?'],
      ['C', 'אין לי העדפה'],
      ['D', 'לא משנה לי מתי'],
      ['E', 'תבדוק לי'],
    ]
    for (const [label, text] of vagueContinuations) {
      it(`${label} — bot asked scheduling preference, customer replies "${text}": availability flow runs`, async () => {
        seedSchedulingContext()
        openaiReply = 'בטח! יש לנו כמה אפשרויות פנויות אצל ד"ר עלא יונס 😊\nLEAD:{"reason":"השתלות"}'

        await callAiRespond({
          conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: text,
        })

        expect(ranAvailabilityFlow()).toBe(true)
      })
    }

    // F-G: תגובות שעוברות בבירור לנושא אחר — לא נכנסות למסלול availability
    // למרות שהבוט שאל על תאריך/שעה קודם
    const topicShifts: [string, string][] = [
      ['F', 'כמה זה עולה?'],
      ['G', 'איפה אתם נמצאים?'],
    ]
    for (const [label, text] of topicShifts) {
      it(`${label} — bot asked scheduling preference, customer replies "${text}": availability flow does NOT run`, async () => {
        seedSchedulingContext()
        openaiReply = 'בשמחה, אענה לך על זה! 😊\nLEAD:{"reason":"השתלות"}'

        await callAiRespond({
          conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: text,
        })

        expect(ranAvailabilityFlow()).toBe(false)
      })
    }

    // H: ביטויים ישירים קיימים ("מתי פנוי?") ממשיכים לעבוד בדיוק כמו היום —
    // גם בלי הקשר של שאלת-scheduling קודמת מהבוט (regression, לא תלוי ב-1A)
    it('H — direct existing phrase "מתי פנוי?" continues to work exactly as before, with no scheduling-context needed at all', async () => {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docB: ['השתלות'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = { docB: allWeekSchedule('09:00', '11:00') }
      fakeDb.seed('profiles', [{ id: 'docB', full_name: 'ד"ר עלא יונס', business_id: 'biz1' }])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה השתלה', sender_type: 'contact' },
      ])
      openaiReply = 'בטח! יש לנו כמה אפשרויות 😊\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
      })

      expect(ranAvailabilityFlow()).toBe(true)
    })

    // I: SAFE_SLOT_RESPONSE עם שני "ימי שלישי" בתאריכים שונים — הלקוח רואה
    // תאריכים מובחנים בפועל (end-to-end, לא רק unit test על buildSafeSlotResponse)
    it('I — SAFE_SLOT_RESPONSE with two Tuesdays on different dates: the customer sees distinct full dates, not just the weekday twice', async () => {
      seedSchedulingContext()
      // המודל מתעלם מה-slots האמיתיים ("אין זמינות") — מכריח SAFE_SLOT_RESPONSE
      openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי אפשר?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      // אם באמת יש שני "יום שלישי" ברשימה (סביר עם שבוע ימי-עבודה זהים
      // בטווח 14 יום), כל אחד מהם חייב לכלול תאריך מלא משלו כדי להיות מובחן
      const tuesdayLines = (sendCall!.body.message as string).split('\n').filter((l: string) => l.startsWith('יום שלישי'))
      if (tuesdayLines.length > 1) {
        expect(new Set(tuesdayLines).size).toBe(tuesdayLines.length) // כל שורה שונה (יש בה תאריך)
      }
      expect(sendCall!.body.message).toMatch(/\d{2}\.\d{2}/) // יש תאריך DD.MM בתשובה בפועל
    })

    // J: שחזור מדויק של השיחה האמיתית מפרודקשן
    it('J — real production replay: bot asks preference, customer says "מתי אפשר?" — real availability engine runs, no free-form invented slots', async () => {
      seedSchedulingContext()
      openaiReply = 'יש לנו מספר תורים פנויים עם ד"ר עלא יונס:\n\n- יום שלישי בשעה 11:00\n- יום שלישי בשעה 15:00\n- יום רביעי בשעה 14:00\n\nמה הכי מתאים לך?\nLEAD:{"reason":"השתלות"}'

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי אפשר?',
      })

      // המסלול האמיתי רץ בפועל (לא דילג כמו בתקרית המקורית)
      expect(ranAvailabilityFlow()).toBe(true)
      // ותשובת ה-LLM (שהשמיטה תאריך, בדיוק כמו בפועל) לא נשלחה כמו שהיא —
      // הוחלפה בתשובה מבוססת-נתונים עם תאריך מלא
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toMatch(/\d{2}\.\d{2}/)
    })
  })

  // ─── FIX 1 + FIX 2 — HARDENING (יוסי, 01/09, שני מקרי פרודקשן אמיתיים) ───
  // FIX 1: doctor preference מוגבל לנושא הפעיל (resolveActiveServiceAnchor),
  // לא זולג מנושאים ישנים ונטושים בשיחה. FIX 2: כשבדיקת שעה מדויקת אחת
  // (findAvailableDoctorForExactSlot, במסלול extractOfferedDateTime הישן)
  // מאמתת status:'available', התשובה נבנית דטרמיניסטית מה-code
  // (buildSafeExactSlotResponse) — לעולם לא נשלחת סתירה מה-LLM
  describe('FIX 1/FIX 2 hardening — doctor preference scoped to active topic, exact-slot availability decided by code, never by the LLM', () => {
    // 6-9: EXACT SLOT — service='הלבנה', doctor=מסאוורה, יום רביעי 14:00
    function seedExactSlotScenario() {
      seedBaseline()
      fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
      fakeDb.tables.businesses[0].settings.employee_responsibilities = { docC: ['הלבנה'] }
      fakeDb.tables.businesses[0].settings.employee_schedules = {
        docC: [{ day: 'רביעי', open: '10:00', close: '16:00', closed: false }],
      }
      fakeDb.seed('profiles', [
        { id: 'docC', full_name: 'ד"ר מסאוורה', business_id: 'biz1' },
        { id: 'docD', full_name: 'ד"ר גבי סמל', business_id: 'biz1' }, // לא מוסמך להלבנה — לצורך test 8 בלבד
      ])
      fakeDb.seed('messages', [
        { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה תור להלבנת שיניים', sender_type: 'contact' },
      ])
      return nextWeekday(3) // רביעי הקרוב
    }

    // 6 — EXACT AVAILABLE, שחזור המקרה האמיתי: הלקוח מקבל תשובת "יש זמינות"
    it('6 — real production scenario: exact slot verified available by code — customer receives an AVAILABLE response with full date, no NO_AVAILABILITY, no escalation', async () => {
      const wednesday = seedExactSlotScenario()
      const dmy = wednesday.split('-').reverse().join('.')
      openaiReply = `יש תור פנוי ב-${dmy} בשעה 14:00 עם ד"ר מסאוורה. מתאים לך? 😊\nLEAD:{"reason":"הלבנה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב 14 יש מצב?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('14:00')
      expect(sendCall!.body.message).toMatch(/\d{2}\.\d{2}/) // תאריך מלא
      expect(sendCall!.body.message).toContain('ד"ר מסאוורה')
      expect(sendCall!.body.message).not.toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 7 — שחזור מדויק: הקוד אימת available, אבל ה-LLM אומר "לא מצאתי" —
    // אסור שהסתירה תישלח, וחייב SAFE_EXACT_SLOT_RESPONSE, בלי הסלמה
    it('7 — code says available, LLM says "לא מצאתי תור זמין": the contradiction is never sent, SAFE_EXACT_SLOT_RESPONSE instead, no escalation', async () => {
      const wednesday = seedExactSlotScenario()
      const dmy = wednesday.split('-').reverse().join('.')
      openaiReply = `לצערי, לא מצאתי תור זמין לד"ר מסאוורה ב-${dmy} בשעה 14:00 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"הלבנה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב 14 יש מצב?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('לא מצאתי תור זמין')
      expect(sendCall!.body.message).toContain('14:00')
      expect(sendCall!.body.message).toContain('ד"ר מסאוורה')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 8 — הקוד אימת available, אבל ה-LLM טעה בשם הרופא — רק התוצאה
    // המאומתת מוצגת (לא גבי סמל, שאינו הרופא האמיתי הפנוי כאן)
    it('8 — code verifies available, LLM names the wrong doctor: only the verified exact result is presented', async () => {
      const wednesday = seedExactSlotScenario()
      const dmy = wednesday.split('-').reverse().join('.')
      openaiReply = `יש תור פנוי ב-${dmy} בשעה 14:00 עם ד"ר גבי סמל. מתאים לך? 😊\nLEAD:{"reason":"הלבנה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב 14 יש מצב?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).not.toContain('ד"ר גבי סמל')
      expect(sendCall!.body.message).toContain('ד"ר מסאוורה')
      expect(sendCall!.body.message).toContain('14:00')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeFalsy()
    })

    // 9 — EXACT UNAVAILABLE — התנהגות קיימת, ללא שינוי
    it('9 — exact slot genuinely unavailable (real collision): existing NO_AVAILABILITY_MESSAGE + escalation, unchanged', async () => {
      const wednesday = seedExactSlotScenario()
      fakeDb.seed('appointments', [{
        id: 'existing1', business_id: 'biz1', lead_id: null, patient_name: 'לקוח אחר', patient_phone: '972500000001',
        assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO(wednesday, '14:00'), duration_minutes: 60,
      }])
      const dmy = wednesday.split('-').reverse().join('.')
      openaiReply = `יש תור פנוי ב-${dmy} בשעה 14:00 עם ד"ר מסאוורה. מתאים לך? 😊\nLEAD:{"reason":"הלבנה"}`

      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב 14 יש מצב?',
      })

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.escalated_at).toBeTruthy()
    })

    // 1/10 — שחזור מלא ומדויק של השיחה האמיתית מפרודקשן: עלא → גבי →
    // הלבנה → "מתי יש?" — doctor preference הישן לא מגביל את החיפוש,
    // וה-slots האמיתיים חוזרים (fixture שקול לזה שנמצא בפועל ב-DB)
    describe('with a frozen clock matching the real incident (01.09.2026, 14:48 Israel)', () => {
      const FROZEN_REAL_INCIDENT_TIME = '2026-09-01T11:48:00.000Z' // = 14:48 שעון ישראל
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(FROZEN_REAL_INCIDENT_TIME))
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('1/10 — Ala → Gabi → whitening → "מתי יש?": stale doctor preference does not constrain findNextAvailableSlots, real slots are returned', async () => {
        seedBaseline()
        fakeDb.tables.businesses[0].settings.services = [{ name: 'השתלות', active: true, duration: '60' }, { name: 'הלבנה', active: true, duration: '60' }]
        fakeDb.tables.businesses[0].settings.employee_responsibilities = {
          docA: ['השתלות'], docB: ['השתלות'], docC: ['הלבנה'],
        }
        fakeDb.tables.businesses[0].settings.employee_schedules = {
          docC: [
            { day: 'שלישי', open: '10:00', close: '16:00', closed: false },
            { day: 'רביעי', open: '10:00', close: '16:00', closed: false },
          ],
        }
        fakeDb.seed('profiles', [
          { id: 'docA', full_name: 'ד"ר עלא יונס', business_id: 'biz1' },
          { id: 'docB', full_name: 'ד"ר גבי סמל', business_id: 'biz1' },
          { id: 'docC', full_name: 'ד"ר מסאוורה', business_id: 'biz1' },
        ])
        // חפיפות שמשאירות בדיוק: 01.09 15:00, 02.09 14:00, 02.09 15:00, 08.09 11:00
        fakeDb.seed('appointments', [
          { id: 'a1', business_id: 'biz1', assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO('2026-09-02', '10:00'), duration_minutes: 60 },
          { id: 'a2', business_id: 'biz1', assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO('2026-09-02', '11:00'), duration_minutes: 60 },
          { id: 'a3', business_id: 'biz1', assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO('2026-09-02', '12:00'), duration_minutes: 60 },
          { id: 'a4', business_id: 'biz1', assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO('2026-09-02', '13:00'), duration_minutes: 60 },
          { id: 'a5', business_id: 'biz1', assigned_to: 'docC', status: 'scheduled', scheduled_at: israelDateTimeISO('2026-09-08', '10:00'), duration_minutes: 60 },
        ])
        // created_at מפורש ועולה לכל הודעה — הכרחי: בלי זה כל השורות שוות
        // (undefined), ה-sort היציב של FakeDb משאיר אותן בסדר ה-seed
        // המקורי גם ב-"order desc", וה-.reverse() ב-route.ts הופך את הכל
        // ל**הפוך** מהסדר הכרונולוגי שהטסט הזה תלוי בו (אינדקסים ל-sinceIndex)
        const baseT = new Date(FROZEN_REAL_INCIDENT_TIME).getTime() - 10 * 60000
        fakeDb.seed('messages', [
          { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'שלום רב, אני רוצה לקבוע ייעוץ עם ד"ר עלא יונס', sender_type: 'contact', created_at: new Date(baseT + 0).toISOString() },
          { id: 'm2', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', content: 'ד"ר עלא יונס מתמחה בהשתלות. יש לך העדפה לתאריך או שעה?', sender_type: 'ai', created_at: new Date(baseT + 1000).toISOString() },
          { id: 'm3', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'בעצם אני רוצה לד"ר גבי סמל', sender_type: 'contact', created_at: new Date(baseT + 2000).toISOString() },
          { id: 'm4', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', content: 'אין בעיה! יש לך העדפה לתאריך או שעה?', sender_type: 'ai', created_at: new Date(baseT + 3000).toISOString() },
          { id: 'm5', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'סליחה אני רוצה לקבוע תור להלבנת שיניים מי מבצע אצלכם?', sender_type: 'contact', created_at: new Date(baseT + 4000).toISOString() },
          { id: 'm6', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound', content: 'טיפול הלבנת שיניים מתבצע על ידי ד"ר מסאוורה. יש לך העדפה לתאריך או שעה?', sender_type: 'ai', created_at: new Date(baseT + 5000).toISOString() },
        ])
        openaiReply = 'בטח! יש לנו כמה אפשרויות פנויות אצל ד"ר מסאוורה 😊\nLEAD:{"reason":"הלבנה"}'

        await callAiRespond({
          conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש?',
        })

        const prompt = openaiCalls[0]?.systemPrompt || ''
        // ה-preferredDoctorId הישן (עלא/גבי) לא הגביל את החיפוש — נמצאו
        // slots אמיתיים אצל מסאוורה, לא מערך ריק
        expect(prompt).toContain('התורים הפנויים הקרובים ביותר')
        expect(prompt).toContain('01.09.2026 15:00')
        expect(prompt).toContain('02.09.2026 14:00')
        expect(prompt).toContain('02.09.2026 15:00')
        expect(prompt).toContain('08.09.2026 11:00')
        // "שיוך שירותים לרופאים" מציג את כל הרופאים תמיד (מידע כללי) —
        // הבדיקה הרלוונטית היא שורת ה-slots האמיתית עצמה, לא הפרומפט כולו
        const slotsLine = prompt.split('\n').find(l => l.startsWith('התורים הפנויים הקרובים ביותר'))
        expect(slotsLine).not.toContain('עלא')
        expect(slotsLine).not.toContain('גבי')
        expect(slotsLine).toContain('מסאוורה')
        const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
        expect(conv!.escalated_at).toBeFalsy()
      })
    })
  })

  it('refuses to send at all when the business has no active WhatsApp connection (no silent cross-tenant fallback)', async () => {
    seedBaseline()
    fakeDb.tables.whatsapp_connections = [] // אין חיבור בכלל
    openaiReply = 'שלום, איך אפשר לעזור?'

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלום',
    })
    expect(res.status).toBe(400)
    // חובה: אף קריאה ל-Green API לא בוצעה בכלל
    expect(sentMessages.length).toBe(0)
  })

  it('does not send anything when the bot has already replied within the rate-limit window', async () => {
    seedBaseline()
    fakeDb.tables.messages.push({
      id: 'm2', conversation_id: 'conv1', business_id: 'biz1', direction: 'outbound',
      content: 'תשובה קודמת', sender_type: 'ai', created_at: new Date().toISOString(),
    })
    openaiReply = 'לא אמור להגיע לכאן'

    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'עוד הודעה',
    })
    const json = await res.json()
    expect(json.skipped).toBe('rate_limited')
    expect(sentMessages.length).toBe(0)
  })
})

// ─── רגרסיה: הודעת לקוח לא "נעלמת" כשהיא מגיעה תוך כדי שריצה קודמת עדיין ────
// מעבדת (יוסי, 30/08 — רחל מוגרבי: "1 _כן" נענה, אבל "אני מכפר יונה" שנשלחה
// 11 שניות אחר-כך לא קיבלה עיבוד עצמאי משלה — נחסמה ע"י ה-lock/rate-limit
// והלכה לאיבוד עד שהלקוחה חזרה על עצמה בעצמה). כאן בודקים את המנגנון
// שמתקן את זה: cursor (conversations.ai_last_batch_at) שנשמר בסוף כל batch,
// ונבדק שוב ע"י ה-POST handler לפני שהוא באמת מסיים — לא רק "5 שניות אחורה
// מעכשיו" (שלא היה תופס פער של 11 שניות)
describe('ai-respond POST — follow-up processing for messages that arrive mid-run (ROOT CAUSE A fix)', () => {
  // timeout מוארך: ריצת follow-up מוסיפה עוד סבב שהייה-אנושית מלאכותית
  // (typing indicator + delay) מעל הריצה הראשונה, ועובר את ברירת המחדל (5s)
  it('does not lose a message that arrives ~11s after the triggering message — it gets processed as a follow-up, not silently dropped', async () => {
    seedBaseline()
    fakeDb.tables.messages = [{
      id: 'mA', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
      content: 'הודעה ראשונה', created_at: new Date().toISOString(),
    }]
    openaiReply = 'תשובה כללית 😊'

    // מדמה הודעה שממש נשלחת תוך כדי שה-run הראשון מעבד: מזריקים אותה ל-DB
    // באמצע ה-flow עצמו (ברגע שהקריאה הראשונה ל-OpenAI מתבצעת — אחרי
    // שה-batch הראשון כבר נשלף מה-DB, בדיוק כמו התזמון האמיתי שקרה בפועל).
    // created_at שלה מאוחר בכוונה מ-mA, כדי לוודא שהיא זו שנתפסת כ"ממתינה"
    let injected = false
    const realFetch = (globalThis.fetch as any)
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (url.includes('api.openai.com') && !injected) {
        injected = true
        fakeDb.tables.messages.push({
          id: 'mB', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
          content: 'הודעה שנייה שהגיעה תוך כדי עיבוד', created_at: new Date(Date.now() + 11000).toISOString(),
        })
      }
      return realFetch(url, opts)
    }))

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'הודעה ראשונה',
    })

    const sends = sentMessages.filter(m => m.url.includes('sendMessage'))
    // שתי תשובות נשלחו — אחת לכל הודעה — לא הודעה כפולה לאותה הודעה, ולא
    // הודעה שהלכה לאיבוד בלי מענה בכלל
    expect(sends.length).toBe(2)
    expect(openaiCalls.length).toBe(2)
    // הקריאה השנייה ל-OpenAI חייבת לכלול את תוכן ההודעה השנייה — ההוכחה
    // שהיא לא "נעלמה" מהקונטקסט שהמודל ראה
    expect(openaiCalls[1].userMessage).toContain('הודעה שנייה שהגיעה תוך כדי עיבוד')
  }, 15000)

  it('merges multiple messages that arrive during processing into a single follow-up turn, not a burst of separate replies', async () => {
    seedBaseline()
    fakeDb.tables.messages = [{
      id: 'mA', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
      content: 'הודעה ראשונה', created_at: new Date().toISOString(),
    }]
    openaiReply = 'תשובה כללית 😊'

    // מזריק שתי הודעות (B ואז C, שנייה-שתיים אחרי) תוך כדי ה-run הראשון —
    // שתיהן אמורות להתאחד לתשובת follow-up אחת, לא שתי תשובות נפרדות
    let injected = false
    const realFetch = (globalThis.fetch as any)
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: any) => {
      if (url.includes('api.openai.com') && !injected) {
        injected = true
        const base = Date.now()
        fakeDb.tables.messages.push(
          { id: 'mB', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact', content: 'אני מכפר יונה', created_at: new Date(base + 11000).toISOString() },
          { id: 'mC', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact', content: 'ועדיף בבוקר', created_at: new Date(base + 13000).toISOString() },
        )
      }
      return realFetch(url, opts)
    }))

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'הודעה ראשונה',
    })

    const sends = sentMessages.filter(m => m.url.includes('sendMessage'))
    // לא 3 תשובות (אחת לכל הודעה) — רק 2: אחת ל-A, אחת מאוחדת ל-B+C יחד
    expect(sends.length).toBe(2)
    expect(openaiCalls.length).toBe(2)
    expect(openaiCalls[1].userMessage).toContain('אני מכפר יונה')
    expect(openaiCalls[1].userMessage).toContain('ועדיף בבוקר')
  }, 15000)

  it('does not trigger any follow-up run when no new message arrived while processing', async () => {
    seedBaseline()
    fakeDb.tables.messages = [{
      id: 'mA', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
      content: 'הודעה יחידה', created_at: new Date().toISOString(),
    }]
    openaiReply = 'תשובה כללית 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'הודעה יחידה',
    })

    // בלי הודעה חדשה שממתינה — אסור שתיווצר ריצה נוספת (לא לולאה מיותרת,
    // לא קריאה כפולה ל-OpenAI, לא הודעה כפולה ללקוח)
    expect(openaiCalls.length).toBe(1)
    expect(sentMessages.filter(m => m.url.includes('sendMessage')).length).toBe(1)
  })

  it('does not create concurrent runs — the lock is held for the entire follow-up loop, not re-claimed per iteration', async () => {
    seedBaseline()
    const now = Date.now()
    fakeDb.tables.messages = [{
      id: 'mA', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
      content: 'הודעה ראשונה', created_at: new Date(now).toISOString(),
    }, {
      id: 'mB', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', sender_type: 'contact',
      content: 'הודעה שנייה', created_at: new Date(now + 11000).toISOString(),
    }]
    openaiReply = 'תשובה כללית 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'הודעה ראשונה',
    })

    // הנעילה תמיד משוחררת לגמרי בסיום — גם אחרי לולאת follow-up
    expect(fakeDb.tables.conversations[0].ai_processing_started_at).toBeNull()
  })
})

// ─── חזרה מאוחרת יותר (REMIND) — אכיפה קשיחה בקוד, דו-שלבית ─────────────────
// (דרישה עסקית 3): לא רק "הבטחה" של המודל — עצירה מלאה של בירור
// טיפול/הצעת תור בקוד, גם דרך שתי הודעות נפרדות (יום בלי שעה בהודעה 1,
// שעה בלי מילת-טריגר בהודעה 2)
describe('later-callback request (REMIND) — code-enforced, two-turn regression', () => {
  // (multi-tenant isolation, ביקורת רביעית): בלי הדגל enforce_callback_
  // reminders, אפילו ניסוח מובהק כמו "תחזרו אלי מאוחר יותר" לא נכנס
  // למנגנון הדטרמיניסטי בכלל — הבוט ממשיך להתנהג בדיוק כמו לפני התכונה
  // הזו (המודל מקבל את ההודעה כרגיל, עם REMIND רק דרך תגית שהוא עצמו כותב)
  it('without enforce_callback_reminders (default false): a clear callback phrase does not engage the deterministic flow at all — the model is called normally, exactly like before this feature existed', async () => {
    seedBaseline() // בכוונה בלי seedCallbackEnabledBaseline — בודקים את ברירת המחדל
    openaiReply = 'בטח, נחזור אליך 🙏'
    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר בבקשה',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(openaiCalls.length).toBe(1) // המודל כן נקרא — ההתנהגות הישנה

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBeFalsy()
  })

  it('turn 1: asks only for the missing day/time, never calls the model, never offers an appointment', async () => {
    seedCallbackEnabledBaseline()
    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר בבקשה',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)

    // לא נקראה בכלל למודל — עצירה מלאה, לא רק ניסוח שונה שלו
    expect(openaiCalls.length).toBe(0)

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('יום')
    expect(sendCall!.body.message).toContain('שעה')

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBe(true)
  })

  it('turn 2 (separate message, no trigger words at all): a bare day+time completes the callback request, saves next_followup, and still never calls the model', async () => {
    seedCallbackEnabledBaseline()
    // הודעה 1: מפעילה את מצב ההמתנה, בלי יום/שעה
    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר בבקשה',
    })
    expect(fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')!.pending_callback_active).toBe(true)

    // מדמה שהודעה 2 הגיעה יותר משנייה בודדת ה-rate-limit של 5 שניות (לא
    // חלק מהתכונה הנבדקת כאן — שתי הודעות אמיתיות בוואטסאפ כמעט אף פעם לא
    // מגיעות תוך פחות מ-5 שניות; בלי זה, הבדיקה עצמה הייתה נחסמת ע"י
    // ה-rate-limit הקיים, לא ע"י שום דבר קשור ל-REMIND)
    for (const m of fakeDb.tables.messages) {
      if (m.direction === 'outbound') m.created_at = new Date(Date.now() - 10000).toISOString()
    }

    // הודעה 2: "מחר ב-14:00" — בלי שום מילת-טריגר, אבל ה-state עדיין ממתין
    const res2 = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב-14:00',
    })
    const json2 = await res2.json()
    expect(json2.ok).toBe(true)
    expect(openaiCalls.length).toBe(0) // גם בהודעה השנייה — עדיין לא נקרא למודל בכלל

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBe(false)
    expect(conv!.lead_id).toBeTruthy() // נוצר ליד כדי שהכתיבה ל-next_followup לא תיכשל בשקט

    const lead = fakeDb.tables.leads.find((l: any) => l.id === conv!.lead_id)
    expect(lead!.next_followup).toBeTruthy()

    const sendCall = sentMessages.filter(m => m.url.includes('sendMessage'))[1]
    expect(sendCall!.body.message).toContain('נחזור אליך')
  })

  it('a single message that already contains both day and time (no separate trigger phrase needed after) still saves next_followup directly and skips the model', async () => {
    seedCallbackEnabledBaseline()
    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מחר ב-14:00',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(openaiCalls.length).toBe(0)

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBe(false)
    const lead = fakeDb.tables.leads.find((l: any) => l.id === conv!.lead_id)
    expect(lead!.next_followup).toBeTruthy()
  })

  // דרישה עסקית 3 (ביקורת אחרונה): "אני אחזור אליכם" הוא הכיוון ההפוך —
  // לא בקשה שנחזור אליו/ה. לא נכנסים לכל מנגנון ה-REMIND בכלל, וממשיכים
  // בירור/מענה רגיל (קריאה למודל כרגיל)
  it('"אני אחזור אליכם" (customer will contact us) does not trigger the callback flow at all — the model is still called normally', async () => {
    seedCallbackEnabledBaseline()
    openaiReply = 'בסדר גמור, נשמח לשמוע ממך 😊'
    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'בסדר, אני אחזור אליכם מאוחר יותר',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(openaiCalls.length).toBe(1) // המודל כן נקרא — זו לא בקשת REMIND
    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBeFalsy()
  })

  // דרישה עסקית 3: זמן בעבר — לא נשמר next_followup בעבר, ממשיכים לשאול
  it('a callback time that has already passed today is rejected — asks again instead of saving a past reminder', async () => {
    seedCallbackEnabledBaseline()
    // "היום ב-00:01" יהיה כמעט תמיד בעבר בזמן שהבדיקה רצה בפועל (היום
    // עצמו, אבל שעה שכבר עברה כמעט תמיד) — משתמשים בזמן קבוע במקום כדי
    // שהבדיקה תהיה דטרמיניסטית בכל שעה שהיא רצה בפועל
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-06T10:00:00.000Z')) // שלישי, 12:00 בישראל
    try {
      const res = await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי היום ב-09:00',
      })
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(openaiCalls.length).toBe(0)

      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      // לא סוגרים את הבקשה עם זמן שכבר עבר — ממשיכים לבקש יום/שעה
      expect(conv!.pending_callback_active).toBe(true)
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('יום')
      expect(sendCall!.body.message).toContain('שעה')
    } finally {
      vi.useRealTimers()
    }
  })

  // דרישה עסקית 3 (ביקורת שנייה): "פחות משעה בעבר" אסור להתקבל רק בגלל
  // שזה פחות משעה — סובלנות טכנית מינימלית בלבד (60 שניות), לא "חלון חסד"
  // של שעה. 30 דקות בעבר היו מתקבלות (בטעות) תחת הסובלנות הישנה של שעה —
  // הבדיקה הזו נכשלת אם מישהו יחזיר בטעות את חלון השעה
  it('a callback time only 30 minutes in the past is still rejected — no next_followup saved, keeps asking, never guesses a future time on its own', async () => {
    seedCallbackEnabledBaseline()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-06T10:00:00.000Z')) // שלישי, 12:00 בישראל
    try {
      const res = await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי היום ב-11:30',
      })
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(openaiCalls.length).toBe(0)

      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv!.pending_callback_active).toBe(true)
      // לא ניחשנו מועד עתידי חלופי (למשל "מחר") — פשוט חוזרים לשאול
      const lead = fakeDb.tables.leads.find((l: any) => l.id === conv!.lead_id)
      expect(lead?.next_followup).toBeFalsy()
      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      expect(sendCall!.body.message).toContain('יום')
      expect(sendCall!.body.message).toContain('שעה')
    } finally {
      vi.useRealTimers()
    }
  })

  // דרישה עסקית 3: שעה/יום מעורפלים ("מתישהו") — לא נחשב פתרון, ממשיכים לשאול
  it('a vague, unparseable time ("מתישהו") is treated as still missing — keeps asking, never guesses', async () => {
    seedCallbackEnabledBaseline()
    const res = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מתישהו',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(openaiCalls.length).toBe(0)
    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBe(true)
    expect(conv!.pending_callback_date).toBeFalsy()
    expect(conv!.pending_callback_time).toBeFalsy()
  })

  // דרישה עסקית 3: ביטול תוך כדי המתנה — לא ממשיכים לשאול יום/שעה
  it('cancelling mid-wait ("לא משנה, אני אחזור אליכם") clears the pending state without asking for a day/time again', async () => {
    seedCallbackEnabledBaseline()
    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר',
    })
    expect(fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')!.pending_callback_active).toBe(true)

    for (const m of fakeDb.tables.messages) {
      if (m.direction === 'outbound') m.created_at = new Date(Date.now() - 10000).toISOString()
    }

    const res2 = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'לא משנה, אני אחזור אליכם',
    })
    const json2 = await res2.json()
    expect(json2.ok).toBe(true)
    expect(openaiCalls.length).toBe(0)

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.pending_callback_active).toBe(false)
    expect(conv!.pending_callback_date).toBeFalsy()
    expect(conv!.pending_callback_time).toBeFalsy()
    // ביטול לא יוצר next_followup — לא "מנחשים" תזכורת שהלקוח בעצם ויתר עליה
    const lead = fakeDb.tables.leads.find((l: any) => l.id === conv!.lead_id)
    expect(lead?.next_followup).toBeFalsy()

    const sendCall = sentMessages.filter(m => m.url.includes('sendMessage'))[1]
    expect(sendCall!.body.message).not.toContain('יום')
    expect(sendCall!.body.message).not.toContain('שעה')
  })

  // דרישה עסקית 2 (ביקורת אחרונה): המסלול הדטרמיניסטי עובר דרך אותה ליבת
  // שליחה/שמירה כמו התשובה הרגילה — כולל ניקוי תזכורת שכבר בשלה
  it('the deterministic callback path also clears an already-due reminder, exactly like the normal send pipeline', async () => {
    seedCallbackEnabledBaseline()
    fakeDb.seed('leads', [{ id: 'lead1', business_id: 'biz1', phone: '972500000000', name: 'לקוח', next_followup: new Date(Date.now() - 60000).toISOString() }])
    fakeDb.tables.conversations[0].lead_id = 'lead1'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר',
    })

    const lead = fakeDb.tables.leads.find((l: any) => l.id === 'lead1')
    expect(lead!.next_followup).toBeNull()
  })

  // ─── דרישה עסקית 1 (ביקורת שלישית): אימות שמירה אמיתי, לא "ירינו וזהו" ────
  describe('callback reminder persistence is verified, not assumed', () => {
    it('when the leads.next_followup update itself fails: does not tell the customer it was scheduled, keeps pending_callback_active so a retry can succeed later', async () => {
      seedCallbackEnabledBaseline()
      fakeDb.failNextWrite('leads', 'update')

      const res = await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מחר ב-14:00',
      })
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(openaiCalls.length).toBe(0)

      const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      // ה-state נשאר "ממתין" (בר-ניסיון-חוזר), לא נמחק כאילו הצליח
      expect(conv!.pending_callback_active).toBe(true)
      expect(conv!.pending_callback_date).toBeTruthy()
      expect(conv!.pending_callback_time).toBeTruthy()

      const lead = fakeDb.tables.leads.find((l: any) => l.id === conv!.lead_id)
      expect(lead?.next_followup).toBeFalsy()

      const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
      // לא הבטחה שקרית — לא "נקבע"/"הועברה" בלי אימות אמיתי
      expect(sendCall!.body.message).not.toContain('נחזור אליך ב')
    })

    it('when the read-back verification query itself fails (cannot confirm what was actually saved): does not tell the customer it was scheduled', async () => {
      seedCallbackEnabledBaseline()
      await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מאוחר יותר',
      })
      const conv1 = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv1!.pending_callback_active).toBe(true) // עוד אין יום/שעה

      // הכתיבה עצמה (leads.update) מצליחה, אבל שאילתת האימות-בחזרה
      // (leads.select) נכשלת — לא ניתן לוודא שהערך שבאמת נשמר תואם למה
      // שביקשנו, אז לא מאשרים ללקוח למרות שהכתיבה "עברה" ברמת ה-API
      fakeDb.failNextWrite('leads', 'select')
      for (const m of fakeDb.tables.messages) {
        if (m.direction === 'outbound') m.created_at = new Date(Date.now() - 10000).toISOString()
      }
      const res2 = await callAiRespond({
        conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מחר ב-14:00',
      })
      const json2 = await res2.json()
      expect(json2.ok).toBe(true)

      const conv2 = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
      expect(conv2!.pending_callback_active).toBe(true)
      const sendCall = sentMessages.filter(m => m.url.includes('sendMessage'))[1]
      expect(sendCall!.body.message).not.toContain('נחזור אליך ב')
    })
  })

  // ⚠️ הבדיקה הזו בודקת rate-limiting, לא idempotency אמיתית — הן לא אותו
  // דבר (ביקורת קוד): rate-limit חוסם רק קריאות קרובות בזמן;
  // מניעת עיבוד כפול אמיתי של אותה הודעת וואטסאפ (whatsapp_message_id)
  // קורית **לפני** ai-respond בכלל, בשכבת ה-ingest (whatsappIngest.ts:56-62,
  // מגובה גם באילוץ ייחודי ב-DB — supabase/messages_dedup_migration.sql) —
  // כבר יש לזה בדיקה אמיתית קיימת: webhook/route.test.ts:103 ("does not
  // process the same whatsapp message twice (unique-constraint dedup) and
  // does not trigger ai-respond again"), שמאמתת שהודעה עם whatsapp_message_id
  // שכבר קיים לא נוצרת פעמיים ושה-webhook לא מפעיל את הבוט שוב — גם מחוץ
  // לחלון rate-limit (זה בכלל שכבה נפרדת, לא תלוי בזמן). זו הבדיקה כאן
  // ממשיכה לבדוק rate-limiting בלבד, בשמה הנכון
  it('rate limiting (not the same as idempotency): a second ai-respond call within the 5-second window is skipped, not a duplicate reminder/message', async () => {
    seedCallbackEnabledBaseline()
    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מחר ב-14:00',
    })
    const sentCountAfterFirst = sentMessages.filter(m => m.url.includes('sendMessage')).length
    const conv1 = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    const leadIdAfterFirst = conv1!.lead_id
    const nextFollowupAfterFirst = fakeDb.tables.leads.find((l: any) => l.id === leadIdAfterFirst)?.next_followup

    // אותו webhook "מגיע שוב" תוך כדי חלון ה-rate-limit (5 שניות) —
    // לא מזיזים את השעון בין הקריאות, בדיוק כמו webhook כפול אמיתי
    const res2 = await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'תחזרו אלי מחר ב-14:00',
    })
    const json2 = await res2.json()
    expect(json2.skipped).toBe('rate_limited')

    expect(sentMessages.filter(m => m.url.includes('sendMessage')).length).toBe(sentCountAfterFirst)
    const nextFollowupAfterSecond = fakeDb.tables.leads.find((l: any) => l.id === leadIdAfterFirst)?.next_followup
    expect(nextFollowupAfterSecond).toBe(nextFollowupAfterFirst)
  })
})

// ─── no_match — no clear service→doctor mapping ─────────────────────────────
// (דרישה עסקית 6): אם אין התאמה ודאית — לא מנחשים, לא מציעים תור,
// מעבירים לבדיקה אנושית. שונה מ-fully_blocked (שם יש שיוך ודאי, רק אין
// יומן פתוח) — כאן אין שום שיוך ודאי לשירות המבוקש בכלל
describe('no_match — a known service the business defined, with a doctor↔service mapping configured, but no doctor mapped to this specific service', () => {
  it('never guesses/offers an appointment for an availability inquiry — hands off to a rep instead', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
    fakeDb.tables.businesses[0].settings.services = [{ name: 'יישור שיניים', active: true, duration: '60' }]
    // יש שיוך שירותים מוגדר בעסק, אבל לא לשירות הזה בכלל
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה יישור שיניים', sender_type: 'contact' },
    ])
    openaiReply = 'בטח, יש לנו כמה אפשרויות פנויות 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).not.toContain('התורים הפנויים הקרובים ביותר')

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).not.toContain('לא מצאתי')
    expect(sendCall!.body.message).not.toContain('לא זמין')
    expect(sendCall!.body.message).toContain('הועברה')
    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeTruthy()
    expect(fakeDb.tables.appointments).toHaveLength(0)
  })

  // (multi-tenant isolation, ביקורת רביעית): אותו תרחיש בדיוק, בלי הדגל —
  // חוזרים בדיוק להתנהגות הישנה (findNextAvailableSlots הרגילה, שלא נגעתי
  // בה, מזהה שאין רופא/ה מתאים/ה ומזריקה "לא נמצאה זמינות" לפרומפט)
  it('the same no_match scenario WITHOUT strict_service_doctor_booking: falls back to old behavior, not the new deterministic handoff', async () => {
    seedBaseline() // בכוונה בלי strict_service_doctor_booking
    fakeDb.tables.businesses[0].settings.services = [{ name: 'יישור שיניים', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה יישור שיניים', sender_type: 'contact' },
    ])
    openaiReply = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.\nLEAD:{"reason":"יישור שיניים"}\nESCALATE:["אין זמינות"]'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('לא נמצאה זמינות אמיתית')

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toBe('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')
    expect(sendCall!.body.message).not.toContain('הועברה')
  })
})

// ─── שיוך שירות-רופא: קביעה אוטומטית רק עם התאמה מלאה בשלושה תנאים ──────────
// (דרישה עסקית 5): שירות ברשימת השירותים הפעילה + שיוך ודאי
// ב-employee_responsibilities + לוח פתוח ב-employee_schedules — ורק אז
describe('auto-offer requires the full three-way match (service in services + mapped in employee_responsibilities + verified open schedule)', () => {
  it('offers real hours normally when all three conditions hold', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '10:00', close: '16:00', closed: false }],
    }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה הלבנה ביום שלישי', sender_type: 'contact' },
    ])
    openaiReply = 'בטח, יש לנו כמה אפשרויות פנויות 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('זמינות אמיתית ב-')
    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeFalsy()
  })
})

// ─── strict_service_doctor_booking — הגדרה per-עסק, ברירת מחדל false ────────
// (דרישה עסקית, ביקורת קוד): מערכת multi-tenant — בלי הדגל, שום
// עסק לא מקבל שינוי התנהגות. עם הדגל (למשל שקד קליניק), unverified
// (empResponsibilities/employee_schedules חסרים) מעביר לנציג בדיוק כמו
// no_match/fully_blocked, לא רק אלה
describe('strict_service_doctor_booking business setting', () => {
  it('default (flag not set): an unverified service (no employee_responsibilities configured at all) is treated like has_calendar — no forced handoff, exactly like before this setting existed', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
    // אין employee_responsibilities בכלל — לא מוגדר strict_service_doctor_booking
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה הלבנה', sender_type: 'contact' },
    ])
    openaiReply = 'בטח, יש לנו כמה אפשרויות פנויות 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
    })

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeFalsy()
    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).not.toContain('נציג המרפאה, שיחזור')
  })

  it('strict_service_doctor_booking=true: the same unverified case now hands off to a rep instead of proceeding', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
    // עדיין אין employee_responsibilities בכלל — unverified
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה הלבנה', sender_type: 'contact' },
    ])
    openaiReply = 'בטח, יש לנו כמה אפשרויות פנויות 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי יש לכם?',
    })

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeTruthy()
    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('הועברה')
    expect(sendCall!.body.message).not.toContain('לא מצאתי')
  })

  it('strict_service_doctor_booking=true does not affect a fully-verified has_calendar case — still offers real hours normally', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'הלבנה', active: true, duration: '60' }]
    fakeDb.tables.businesses[0].settings.strict_service_doctor_booking = true
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['הלבנה'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '10:00', close: '16:00', closed: false }],
    }
    fakeDb.seed('profiles', [{ id: 'docA', full_name: 'ד"ר דנה כהן', business_id: 'biz1' }])
    fakeDb.seed('messages', [
      { id: 'm1', conversation_id: 'conv1', business_id: 'biz1', direction: 'inbound', content: 'אני רוצה הלבנה ביום שלישי', sender_type: 'contact' },
    ])
    openaiReply = 'בטח, יש לנו כמה אפשרויות פנויות 😊'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'מתי פנוי?',
    })

    const prompt = openaiCalls[0]?.systemPrompt || ''
    expect(prompt).toContain('זמינות אמיתית ב-')
    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeFalsy()
  })
})
