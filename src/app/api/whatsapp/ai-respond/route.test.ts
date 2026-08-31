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

function nextWeekday(target: number): string {
  const d = new Date()
  d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7 || 7))
  return d.toISOString().slice(0, 10)
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
  // הימים. יוסי קבע: כשאין רופא זמין בפועל, הבוט אומר זאת בנימוס ומעביר
  // לנציג — לא קובע בכל זאת. בודקים גם שזה מסומן "ממתין לנציג" לצוות
  it('tells the customer no doctor is available and flags the conversation for a rep, when every qualified doctor is closed', async () => {
    seedBaseline()
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

    expect(json.appointment?.ok).toBe(false)
    expect(json.appointment?.error).toBe('no_doctor_available')
    expect(fakeDb.tables.appointments).toHaveLength(0)

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('נציג')
    expect(sendCall!.body.message).not.toContain('תקלה טכנית')

    const conv = fakeDb.tables.conversations.find((c: any) => c.id === 'conv1')
    expect(conv!.escalated_at).toBeTruthy()
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

  it('still sends a genuine offer when a qualified doctor really is available that day', async () => {
    seedBaseline()
    fakeDb.tables.businesses[0].settings.services = [{ name: 'טיפולים משמרים', active: true, duration: '30' }]
    fakeDb.tables.businesses[0].settings.employee_responsibilities = { docA: ['טיפולים משמרים'] }
    fakeDb.tables.businesses[0].settings.employee_schedules = {
      docA: [{ day: 'שלישי', open: '09:00', close: '16:00', closed: false }],
    }
    // 01.09.2026 הוא יום שלישי בפועל — הרופא כן עובד
    openaiReply = 'יש לנו תור פנוי ביום שלישי הקרוב, 01.09.2026, בשעה 10:00. האם זה מתאים לך? 😊\nLEAD:{"reason":"סתימה"}'

    await callAiRespond({
      conversationId: 'conv1', businessId: 'biz1', senderPhone: '972500000000', messageText: 'שלישי',
    })

    const sendCall = sentMessages.find(m => m.url.includes('sendMessage'))
    expect(sendCall!.body.message).toContain('01.09.2026')
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
      const tuesday = '2026-09-01' // יום שלישי בפועל
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
      const tuesday = '2026-09-01'
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
      const tuesday = '2026-09-01'
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
      const tuesday = '2026-09-01'
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
      const tuesday = '2026-09-01'
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
      const tuesday = '2026-09-01'
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
