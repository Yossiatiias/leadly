// ─── אינטגרציה עם אופטימה (מערכת ניהול המרפאה של שקד קליניק) ────────────────
// שלב 1 בלבד: כשהבוט קובע תור אצלנו, שולחים אותו גם לאופטימה (כיוון אחד).
// אין webhook מהצד שלהם — כיוון הפוך (אופטימה → אנחנו) ידרוש polling נפרד.
// תיעוד חי: https://calendar.hatosafim.co.il/api2/docs

export interface OptimaConfig {
  baseUrl: string
  username: string
  password: string
  company: string
}

// businesses.settings.optima נשמר ב-DB עם שמות snake_case (עקבי עם שאר
// ה-settings, למשל working_hours_table) — הממשק הזה ממיר לצורה שנוחה לקוד.
// מחזיר null אם חסר שדה חובה, כדי שהקורא לא יבנה בקשה חלקית בשקט
export function toOptimaConfig(raw: unknown): OptimaConfig | null {
  const r = raw as Record<string, string> | null | undefined
  if (!r?.base_url || !r?.username || !r?.password || !r?.company) return null
  return { baseUrl: r.base_url, username: r.username, password: r.password, company: r.company }
}

export interface CreateOptimaAppointmentParams {
  doctorCode: string
  appointmentDateISO: string // ISO instant (UTC), כמו apptResult.newTime
  durationMinutes: number
  siteCode?: string
  subject?: string
  cellPhone?: string
  firstName?: string
  lastName?: string
  remarks?: string
  // מזהה כרטיס מטופל קיים באופטימה. קרה בפועל: בלי card_id, אופטימה יוצרת
  // "בלוק זמן" ריק ביומן בלי שם/טלפון מטופל בכלל (AppointmentType=2), לא
  // תור אמיתי שהצוות רואה — ראו resolveOptimaCardId למטה
  cardId?: string
}

// תאריך/שעה בפורמט שאופטימה דורשת (DD/MM/YYYY, HH:MM:SS), לפי שעון ישראל —
// לא UTC גולמי, אחרת התור ייכתב שעה-שעתיים לא נכון אצלם
export function formatOptimaDateTime(iso: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00'
  return {
    date: `${get('day')}/${get('month')}/${get('year')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

export function buildCreateAppointmentQuery(config: OptimaConfig, params: CreateOptimaAppointmentParams): URLSearchParams {
  const { date, time } = formatOptimaDateTime(params.appointmentDateISO)
  const qs = new URLSearchParams()
  qs.set('company', config.company)
  qs.set('doctor_code', params.doctorCode)
  qs.set('site_code', params.siteCode || '1')
  qs.set('appointment_date', date)
  qs.set('appointment_start_time', time)
  qs.set('duration_minutes', String(params.durationMinutes))
  if (params.cardId) qs.set('card_id', params.cardId)
  if (params.subject) qs.set('subject', params.subject)
  if (params.cellPhone) qs.set('cell_phone', params.cellPhone)
  if (params.firstName) qs.set('first_name', params.firstName)
  if (params.lastName) qs.set('last_name', params.lastName)
  if (params.remarks) qs.set('remarks', params.remarks)
  return qs
}

export interface OptimaResult {
  ok: boolean
  status?: number
  raw?: unknown
  error?: string
  // מזהה התור אצל אופטימה, אם הוחזר בתגובה — נשמר אצלנו כדי שרשת הביטחון
  // היומית (שלב 2) תדע לזהות שהתור הזה כבר מוכר לה ולא ליצור כפילות
  optimaAppointmentId?: string
}

export async function createOptimaAppointment(config: OptimaConfig, params: CreateOptimaAppointmentParams): Promise<OptimaResult> {
  const base = config.baseUrl.replace(/\/$/, '')
  const qs = buildCreateAppointmentQuery(config, params)
  const url = `${base}/create_appointment?${qs.toString()}`
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    // נבדק בפועל: אופטימה עצמה יכולה לקחת עד כ-30 שניות לפני שהיא מוותרת
    // ומחזירה תשובה לא-חד-משמעית ("no result within 30s") — timeout קצר
    // יותר אצלנו רק גורם לנו לפספס תשובה תקינה שכן מגיעה. זה רץ ב-after()
    // ברקע בלי לעכב את הלקוח בוואטסאפ, אז אין עלות אמיתית להמתין
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(35000),
    })
    const raw = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, raw, error: `HTTP ${res.status}` }
    // result_status '0' = הצלחה (לפי תיעוד ה-API); כל ערך אחר = כשל לוגי גם אם ה-HTTP עצמו 200
    const resultStatus = (raw as { result_status?: string } | null)?.result_status
    if (resultStatus !== undefined && resultStatus !== '0') {
      return { ok: false, status: res.status, raw, error: `result_status=${resultStatus}` }
    }
    const idField = (raw as { AppointmentID?: number | string; appointment_id?: number | string } | null)
    const optimaAppointmentId = idField?.AppointmentID != null ? String(idField.AppointmentID)
      : idField?.appointment_id != null ? String(idField.appointment_id) : undefined
    return { ok: true, status: res.status, raw, optimaAppointmentId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

// ─── חיפוש/יצירת כרטיס מטופל — כדי שתור שנקבע יופיע עם שם וטלפון אמיתיים ────
// נבדק בפועל מול ה-API האמיתי: search_patient מחזיר patients כאובייקט
// (מפתח = card id), לא מערך. הטלפון עצמו יכול להופיע בכל אחד מכמה שדות
// (CellPhone/HomePhone/WorkPhone/ExPhone/ExPhone2) — לא תמיד באותו אחד
export interface OptimaPatientMatch {
  cardId: string
  fullName: string
  phones: string[]
}

export async function searchOptimaPatient(config: OptimaConfig, search: string): Promise<OptimaPatientMatch[]> {
  if (!search) return []
  const base = config.baseUrl.replace(/\/$/, '')
  const qs = new URLSearchParams({ search, company: config.company })
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  try {
    const res = await fetch(`${base}/search_patient?${qs.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return []
    const raw = await res.json().catch(() => null) as { patients?: Record<string, Record<string, unknown>> } | null
    const patients = Object.values(raw?.patients || {})
    return patients
      .map(p => ({
        cardId: String((p.CardId ?? p.CardID ?? p.card_id) ?? ''),
        fullName: String(p.FullName || `${p.FirstName || ''} ${p.LastName || ''}`.trim()),
        phones: [p.CellPhone, p.HomePhone, p.WorkPhone, p.ExPhone, p.ExPhone2]
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      }))
      .filter(p => p.cardId)
  } catch {
    return []
  }
}

export interface CreateOptimaContactParams {
  firstName?: string
  lastName?: string
  cellPhone?: string
  remarks?: string
}

export async function createOptimaContact(
  config: OptimaConfig, params: CreateOptimaContactParams
): Promise<{ ok: true; cardId: string } | { ok: false; error: string; raw?: unknown }> {
  const base = config.baseUrl.replace(/\/$/, '')
  const qs = new URLSearchParams({ company: config.company })
  if (params.firstName) qs.set('first_name', params.firstName)
  if (params.lastName) qs.set('last_name', params.lastName)
  if (params.cellPhone) qs.set('cell_phone', params.cellPhone)
  if (params.remarks) qs.set('remarks', params.remarks)
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  try {
    const res = await fetch(`${base}/create_contact?${qs.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(35000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const raw = await res.json().catch(() => null) as Record<string, unknown> | null
    // תצורת התשובה המדויקת של create_contact לא אומתה עדיין מול ה-API החי
    // (בניגוד ל-create_appointment ו-search_patient, שכן נבדקו) — אין
    // delete_contact ב-API, אז אי אפשר "לנסות ולמחוק" בבטחה כמו עם תורים.
    // אם שם השדה בפועל שונה מהמנוחשים כאן, הפונקציה תיכשל בעדינות (ok:false,
    // raw מצורף ללוג) והקורא ימשיך בלי card_id — לא ייצור תור עם card_id שגוי
    const cardId = raw?.CardID ?? raw?.CardId ?? raw?.card_id ?? raw?.new_card_id ?? raw?.NewCardID
    if (cardId == null || cardId === '' || cardId === '0') return { ok: false, error: 'no card id in response', raw }
    return { ok: true, cardId: String(cardId) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

// הופך את הפורמט הבינלאומי שאנחנו שומרים בו (972XXXXXXXXX) לפורמט המקומי
// שאופטימה משתמשת בו בשדות טלפון/חיפוש (0XXXXXXXXX) — ההפך מ-normalizeOptimaPhone
export function toOptimaLocalPhone(phone972: string): string {
  const digits = (phone972 || '').replace(/\D/g, '')
  if (digits.startsWith('972')) return '0' + digits.slice(3)
  return digits
}

// מוצא card_id של מטופל קיים לפי טלפון, ואם לא נמצא — יוצר כרטיס חדש.
// בלי card_id, create_appointment יוצר בלוק זמן ריק ביומן בלי שם/טלפון —
// זה בדיוק מה שקרה בפועל לפני התיקון הזה. כישלון בכל שלב מחזיר null —
// הקורא (ai-respond) עדיין יוצר את התור בלי card_id כברירת מחדל בטוחה,
// לא חוסם את הקביעה בגלל תקלה בחיפוש/יצירת הכרטיס
export async function resolveOptimaCardId(
  config: OptimaConfig, params: { phone972: string; firstName?: string; lastName?: string }
): Promise<string | null> {
  const localPhone = toOptimaLocalPhone(params.phone972)
  if (localPhone) {
    const matches = await searchOptimaPatient(config, localPhone)
    const exact = matches.find(m => m.phones.some(p => p.replace(/\D/g, '') === localPhone.replace(/\D/g, '')))
    if (exact) return exact.cardId
  }
  // קרה בפועל (24/08, אחרי עדכון גרסה של אופטימה): יצירת כרטיס נכשלה
  // (result_status שונה מ-'0') כשלא סופק last_name בכלל, והצליחה מיד
  // כששם משפחה כן סופק. לרוב אין לנו שם משפחה אמיתי (לקוח נותן רק שם
  // פרטי בוואטסאפ) — לא ממציאים שם אנושי מזויף, פשוט משתמשים במספר
  // הטלפון כמזהה שקוף במקום להשאיר את השדה ריק ולהיכשל
  const lastName = params.lastName || localPhone || 'לקוח וואטסאפ'
  const created = await createOptimaContact(config, { firstName: params.firstName, lastName, cellPhone: localPhone })
  if (!created.ok) {
    console.error('[optima] createOptimaContact failed — appointment will be created without card_id:', JSON.stringify({ error: created.error, raw: created.raw }))
    return null
  }
  return created.cardId
}

// ─── קריאת תורים מאופטימה — לרשת הביטחון היומית (שלב 2) ────────────────────
export interface OptimaRawAppointment {
  AppointmentID: number
  CardID: number
  FullName: string
  FirstName: string
  LastName: string
  CellPhone: string
  AppointmentDate: string // "DD/MM/YYYY 00:00:00"
  AppointmentStartTime: string // "HH:MM:SS"
  AppointmentEndTime: string
  Subject: string
  Remarks: string
  SiteCode: string
  AppointmentType: string // "1" = תור אמיתי, "2" = חסימת זמן פנימית (הפסקה/עובד)
  DoctorCode: string
  DoctorName: string
}

export async function fetchOptimaAppointments(
  config: OptimaConfig, startDDMMYYYY: string, endDDMMYYYY: string
): Promise<{ ok: true; appointments: OptimaRawAppointment[] } | { ok: false; error: string; status?: number }> {
  const base = config.baseUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  const qs = new URLSearchParams({ start: startDDMMYYYY, end: endDDMMYYYY, company: config.company })
  try {
    const res = await fetch(`${base}/appointments?${qs.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    const raw = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: (raw as { detail?: string })?.detail || `HTTP ${res.status}`, status: res.status }
    const appts: OptimaRawAppointment[] = Object.values(raw?.appointments || {})
    return { ok: true, appointments: appts }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

// מנקה מספר טלפון "מלוכלך" מאופטימה (למשל "0549436570אריק") ומנרמל לפורמט
// הבינלאומי שאנחנו שומרים בו (972XXXXXXXXX, בלי +, בלי 0 מוביל)
export function normalizeOptimaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0')) return '972' + digits.slice(1)
  if (digits.length === 9) return '972' + digits // חסר ה-0 המוביל
  return digits
}

// תאריך+שעה של תור אופטימה → ISO instant (מפרש כשעון ישראל)
export function parseOptimaDateTime(appointmentDate: string, startTime: string): string | null {
  const dateMatch = appointmentDate.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  const timeMatch = startTime.match(/^(\d{2}):(\d{2}):(\d{2})/)
  if (!dateMatch || !timeMatch) return null
  const [, dd, mm, yyyy] = dateMatch
  const [, hh, min, ss] = timeMatch
  // אין TZ offset ישיר ב-Date constructor לפי אזור זמן שרירותי — בונים
  // instant לפי UTC ואז מתקנים לפי ההיסט בפועל של ישראל (+3 קיץ / +2 חורף),
  // באותה שיטה שכבר בשימוש ב-botAppointments.ts (israelDateTime)
  const naiveUTC = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.000Z`)
  const tzPart = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(naiveUTC).find(p => p.type === 'timeZoneName')?.value || ''
  const offsetMatch = tzPart.match(/([+-]\d+)/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : 3
  const realUTC = new Date(naiveUTC.getTime() - offsetHours * 3600000)
  return realUTC.toISOString()
}

export function computeDurationMinutes(startTime: string, endTime: string): number {
  const toMinutes = (t: string): number | null => {
    const m = t.match(/^(\d{2}):(\d{2})/)
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
  }
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (start === null || end === null) return 30
  const diff = end - start
  return diff > 0 ? diff : 30
}
