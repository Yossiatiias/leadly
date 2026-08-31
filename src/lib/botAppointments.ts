// ─── ניהול תורים שנקבעים/מוזזים ע"י הבוט ─────────────────────────────────────
// כל שמירה עוברת read-back מהמסד ואימות שהזמן שנשמר זהה לזמן שהתבקש.
// אין הודעת הצלחה ללקוח בלי שהפונקציה הזו החזירה ok:true.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BotApptResult {
  ok: boolean
  action?: 'created' | 'rescheduled' | 'unchanged'
  id?: string
  oldTime?: string | null
  newTime?: string
  verifiedAt?: string
  error?: string
  details?: Record<string, unknown>
  // true אם התאריך שהמודל ביקש תוקן אוטומטית (קפיצה של שבוע קדימה כי השעה
  // המקורית כבר עברה היום) — הקורא (ai-respond) חייב לעדכן את הודעת האישור
  // ללקוח כדי שתשקף את התאריך האמיתי שנשמר, לא את זה שהמודל חשב שהוא ביקש
  dateRolledForward?: boolean
  // מזהה הרופא/המטפל שהתור שויך אליו (profiles.id), אם היה שיוך שירות→רופא
  assignedTo?: string | null
  // משך התור בדקות שבו נשמר בפועל — נדרש למשל לדחיפת התור החוצה (אופטימה)
  durationMinutes?: number
}

// מקבל YYYY-MM-DD או DD.MM.YYYY או DD/MM/YYYY — מחזיר YYYY-MM-DD
// חשוב: DD.MM.YYYY מפוענח יום-קודם (03.08 = 3 באוגוסט, לא 8 במרץ)
export function normalizeApptDate(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  let m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = raw.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// בונה Date לפי שעון ישראל (Asia/Jerusalem) כולל שעון קיץ/חורף (+03/+02)
// כולל אימות round-trip: תאריך לא-קיים (31.02) נדחה במקום להתגלגל בשקט למרץ
export function israelDateTime(dateISO: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const probe = new Date(`${dateISO}T12:00:00Z`)
  if (isNaN(probe.getTime())) return null
  let offsetH = 3
  try {
    const tzPart = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
      .formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || ''
    const om = tzPart.match(/([+-]\d+)/)
    if (om) offsetH = parseInt(om[1])
  } catch { /* fallback +3 */ }
  const [hh, mm] = time.split(':')
  const sign = offsetH >= 0 ? '+' : '-'
  const d = new Date(`${dateISO}T${hh.padStart(2, '0')}:${mm}:00${sign}${String(Math.abs(offsetH)).padStart(2, '0')}:00`)
  if (isNaN(d.getTime())) return null

  // אימות round-trip: מה שנבנה חייב להציג בדיוק את התאריך והשעה שהתבקשו בשעון ישראל
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const get = (t: string) => fmt.find(p => p.type === t)?.value || ''
    const rtDate = `${get('year')}-${get('month')}-${get('day')}`
    const rtTime = `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`
    if (rtDate !== dateISO || rtTime !== `${hh.padStart(2, '0')}:${mm}`) return null
  } catch { /* אם Intl נכשל — נשאיר את התוצאה */ }

  return d
}

// ─── זיהוי תאריך יחסי בטקסט חופשי ("מחר"/"מחרתיים"/"בעוד X ימים") ───────────
// המודל מקבל טבלת תאריכים בפרומפט ואמור להעתיק ממנה, אבל לפעמים מחשב תאריך
// בעצמו וטועה (בפרט כשההודעה הבאה בשיחה רק מתקנת שעה בלי לחזור על היום —
// למשל "מחר בערב" ואז "אז בצהריים"). השכבה הזו קובעת דטרמיניסטית לאיזה יום
// הלקוח/הבוט התכוונו, כדי שהקוד יוכל לתקן את המודל כשהוא סוטה מזה.
const HEB_RELATIVE_DAY_WORDS: Record<string, number> = {
  שלושה: 3, שלשה: 3, ארבעה: 4, חמישה: 5, שישה: 6, שבעה: 7, שמונה: 8, תשעה: 9, עשרה: 10,
}

export function resolveRelativeDayOffset(text: string): number | null {
  if (!text) return null
  if (text.includes('מחרתיים')) return 2
  if (text.includes('בעוד יומיים')) return 2
  const digitMatch = text.match(/בעוד\s+(\d+)\s+ימים/)
  if (digitMatch) return parseInt(digitMatch[1], 10)
  for (const [word, n] of Object.entries(HEB_RELATIVE_DAY_WORDS)) {
    if (text.includes(`בעוד ${word} ימים`)) return n
  }
  if (text.includes('בעוד יום')) return 1
  if (text.includes('מחר')) return 1
  if (text.includes('היום')) return 0
  return null
}

// סורק אחורה בהיסטוריית ההודעות (מהאחרונה לראשונה, עד maxLookback הודעות)
// ומחזיר את היסט הימים של האזכור הכי עדכני — לתפוס בדיוק את מקרה "מחר
// בערב" ואז "אז בצהריים" בלי לחזור על "מחר" בהודעה השנייה
export function findRelativeDayOffsetInHistory(messages: { content: string }[], maxLookback = 6): number | null {
  const start = Math.max(0, messages.length - maxLookback)
  for (let i = messages.length - 1; i >= start; i--) {
    const off = resolveRelativeDayOffset(messages[i].content)
    if (off !== null) return off
  }
  return null
}

// ממיר היסט ימים (0=היום) לתאריך ISO. israelNow חייב כבר לכלול את ההיסט
// לשעון ישראל (ראה upcomingDatesText ב-ai-respond/route.ts לאותה טכניקה)
export function israelDateISOOffset(israelNow: Date, days: number): string {
  return new Date(israelNow.getTime() + days * 86400000).toISOString().slice(0, 10)
}

// טווח קביעת תורים סביר — כל דבר מעבר לזה הוא הזיה של המודל
const MAX_DAYS_AHEAD = 400

const HEB_WEEKDAY_BY_EN: Record<string, string> = {
  Sun: 'ראשון', Mon: 'שני', Tue: 'שלישי', Wed: 'רביעי', Thu: 'חמישי', Fri: 'שישי', Sat: 'שבת',
}

// יום בשבוע (בעברית) של תאריך, לפי שעון ישראל — לא לפי getUTCDay שעלול
// לסטות ליום הלא-נכון קרוב לחצות
export function israelWeekday(d: Date): string {
  const en = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(d)
  return HEB_WEEKDAY_BY_EN[en] || ''
}

export interface WorkingDay { day: string; open: string; close: string; closed: boolean }

// בדיקה שהשעה המבוקשת בתוך שעות הפעילות המוגדרות לאותו יום בשבוע.
// הפרומפט של הבוט מקבל את הטבלה הזו רק כמידע להקשר — לא אכיפה — כך
// שהמודל יכול (בטעות) להציע/לאשר שעה מחוץ לשעות הפעילות. זו שכבת ההגנה
// שמונעת מזה להפוך לתור אמיתי במסד, בדיוק כמו הבדיקות על תאריך/עבר/עתיד.
function checkWithinWorkingHours(scheduledAt: Date, time: string, workingHours?: WorkingDay[]): { ok: true } | { ok: false; day: string; requestedTime: string; open?: string; close?: string } {
  if (!workingHours?.length) return { ok: true } // לא הוגדרו שעות — לא חוסמים
  const dayName = israelWeekday(scheduledAt)
  const dayEntry = workingHours.find(d => d.day === dayName)
  if (!dayEntry) return { ok: true } // אין רשומה ליום הזה — לא חוסמים ליתר ביטחון

  const [hh, mm] = time.split(':')
  const requestedTime = `${hh.padStart(2, '0')}:${mm}`

  if (dayEntry.closed) return { ok: false, day: dayName, requestedTime }
  if (dayEntry.open && dayEntry.close && (requestedTime < dayEntry.open || requestedTime >= dayEntry.close)) {
    return { ok: false, day: dayName, requestedTime, open: dayEntry.open, close: dayEntry.close }
  }
  return { ok: true }
}

// בחירת רופא מתוך כמה מועמדים מתאימים לאותו שירות: מעדיפים מי שבאמת פנוי
// באותו יום (בלי חפיפת זמנים עם תור קיים שלו); אם כמה פנויים — מי שהכי
// פחות עמוס בתורים עתידיים בכלל (רוטציה הוגנת, לא תמיד אותו רופא).
// אם אף אחד מהמועמדים לא פנוי בדיוק בשעה הזו — מחזירים null במקום לבחור
// מישהו תפוס. החלטת יוסי (19/08) אחרי שהתגלה בפועל שרופא שסגר את כל
// הימים שלו עדיין קיבל אישור תור: "בוט קובע לפי זמינות אמיתית ביומן
// בלבד — ימי עבודה ומקום פנוי (שאין תור אחר)". הקורא (saveOrRescheduleBotAppointment)
// דוחה את הקביעה כשאין תוצאה, לא בונה תור עם רופא לא-פנוי
async function pickAvailableDoctor(
  sb: any, businessId: string, candidates: string[], scheduledAt: Date, durationMinutes: number
): Promise<string | null> {
  const dayStart = new Date(scheduledAt); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(scheduledAt); dayEnd.setHours(23, 59, 59, 999)

  const { data: dayAppts } = await sb.from('appointments')
    .select('assigned_to, scheduled_at, duration_minutes')
    .eq('business_id', businessId)
    .in('assigned_to', candidates)
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_at', dayStart.toISOString())
    .lte('scheduled_at', dayEnd.toISOString())

  const slotStart = scheduledAt.getTime()
  const slotEnd = slotStart + durationMinutes * 60000
  const overlaps = (apptStart: string, apptDurMin: number | null) => {
    const aStart = new Date(apptStart).getTime()
    const aEnd = aStart + (apptDurMin || 60) * 60000
    return slotStart < aEnd && slotEnd > aStart
  }

  const busyIds = new Set(
    (dayAppts || [])
      .filter((a: { scheduled_at: string; duration_minutes: number | null }) => overlaps(a.scheduled_at, a.duration_minutes))
      .map((a: { assigned_to: string }) => a.assigned_to)
  )
  const pool = candidates.filter(c => !busyIds.has(c))
  if (pool.length === 0) return null

  const { data: upcoming } = await sb.from('appointments')
    .select('assigned_to')
    .eq('business_id', businessId)
    .in('assigned_to', pool)
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_at', new Date().toISOString())

  const tally: Record<string, number> = {}
  pool.forEach(c => { tally[c] = 0 })
  ;(upcoming || []).forEach((a: { assigned_to: string }) => {
    if (tally[a.assigned_to] !== undefined) tally[a.assigned_to]++
  })

  return pool.reduce((min, c) => (tally[c] < tally[min] ? c : min), pool[0])
}

// מחלץ את התאריך והשעה **האחרונים** שמופיעים בטקסט (בהודעת הזזה, "מ-03.08
// ל-10.08", האחרון הוא החדש) — שכבת ליבה משותפת לכל חילוץ תאריך/שעה מטקסט
// חופשי של הבוט, בין אם זו "אישור" (extractApptFromText) או "הצעה"
// (extractOfferedDateTime)
function parseLastDateTime(text: string): { date: string; time: string } | null {
  const timeMatches = [...text.matchAll(/(\d{1,2}):(\d{2})/g)]
  if (timeMatches.length === 0) return null
  const lastTime = timeMatches[timeMatches.length - 1]
  const time = `${lastTime[1].padStart(2, '0')}:${lastTime[2]}`

  let date: string | null = null
  const dmyMatches = [...text.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{4})/g)]
  const isoMatches = [...text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)]
  if (dmyMatches.length > 0) {
    const m = dmyMatches[dmyMatches.length - 1]
    date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  } else if (isoMatches.length > 0) {
    const m = isoMatches[isoMatches.length - 1]
    date = `${m[1]}-${m[2]}-${m[3]}`
  } else if (text.includes('מחר')) {
    date = new Date(Date.now() + 3 * 3600 * 1000 + 86400000).toISOString().slice(0, 10)
  } else if (text.includes('היום')) {
    date = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
  }
  if (!date) return null
  return { date, time }
}

// חילוץ תור מטקסט חופשי של הבוט (fallback כשאין תגית APPT)
export function extractApptFromText(text: string): { date: string; time: string; service: string } | null {
  const confirmWords = ['מאושר', 'קבענו', 'נקבע', 'אישרתי', 'בואי', 'בוא ב', 'נרשמים', 'נרשם', 'נרשמת', 'נתאם', 'תואם', 'רושם אותך', 'רשמתי', 'נשמח לראותך', 'מחכים לך', 'נחכה לך', 'נגיש', 'קבענו לך', 'הוזז', 'הועבר', 'עודכן']
  if (!confirmWords.some(w => text.includes(w))) return null

  const dt = parseLastDateTime(text)
  if (!dt) return null

  const serviceKeywords = ['עקירה', 'הלבנה', 'ניקוי', 'ייעוץ', 'בדיקה', 'שורש', 'כתר', 'השתל', 'פנורמי', 'אבחון', 'יישור']
  const service = serviceKeywords.find(s => text.includes(s)) || ''
  return { ...dt, service }
}

// ─── הצעת תור בטקסט חופשי (לפני שיש בכלל אישור/תגית APPT) ─────────────────
// קרה בפועל (24/08, אוריין): הבוט אמר "יש לנו תור פנוי ביום שני הקרוב,
// 30.08.2026, בשעה 10:00" — משפט הצעה תמים, לא אישור — בלי לבדוק שהרופא/ה
// היחיד/ה שמטפל/ת בטיפול המבוקש בכלל עובד/ת ביום הזה (הרופא היחיד ל"סתימה"
// עובד רק שלישי/רביעי, לא שני). כשהלקוח באמת ביקש לקבוע, הבדיקה האמיתית
// דחתה — הלקוח קיבל "יש תור" ואז מיד "אין תור", סתירה מוחלטת. שונה
// מ-extractApptFromText: אין כאן מילות אישור, רק "הצעה" — כל טקסט עם
// תאריך+שעה יחד הוא מועמד, כי בדיוק זה מה שצריך לאמת לפני שהוא נשלח
export function extractOfferedDateTime(text: string): { date: string; time: string } | null {
  return parseLastDateTime(text)
}

// בודק אם קיים/ת רופא/ה שמוסמכ/ת לטיפול המבוקש **ועובד/ת ביום הזה בפועל**
// (לפי הלוח האישי, employee_schedules) — נבנה כדי לאמת הצעת תור לפני
// שהיא נשלחת ללקוח, לא רק בזמן קביעה בפועל. שמרני בכוונה: מחזיר true
// (לא חוסם) בכל מצב של מידע חסר/דו-משמעי — השם ("service") לא ידוע, לא
// מוגדר שיוך רופאים בעסק, אף רופא לא מוסמך לטיפול הזה בכלל (פער תצורה,
// לא בעיית זמינות ליום הספציפי), או תאריך שלא ניתן לפענח. false רק כשיש
// ודאות שכל הרופאים המוסמכים סגורים ביום המבוקש
// בודק אם רופא/ה עומד/ת בדרישת "מינימום שעות מראש" שהוגדרה לו/ה
// (employee_min_lead_hours) ביחס לזמן הנוכחי. 0/לא מוגדר = בלי מגבלה
function meetsMinLeadTime(scheduledAt: Date, uid: string, employeeMinLeadHours?: Record<string, number>): boolean {
  const minHours = employeeMinLeadHours?.[uid]
  if (!minHours) return true
  return scheduledAt.getTime() - Date.now() >= minHours * 3600000
}

export function hasQualifiedDoctorOnDate(
  dateISO: string,
  service: string | null | undefined,
  empResponsibilities: Record<string, string[]>,
  employeeSchedules: Record<string, WorkingDay[]>,
  time?: string,
  employeeMinLeadHours?: Record<string, number>
): boolean {
  if (!service || Object.keys(empResponsibilities).length === 0) return true
  const qualified = Object.entries(empResponsibilities)
    .filter(([, svcs]) => svcs.some(s => service.includes(s) || s.includes(service)))
    .map(([uid]) => uid)
  if (qualified.length === 0) return true

  const probe = new Date(`${dateISO}T12:00:00Z`)
  if (isNaN(probe.getTime())) return true
  const dayName = israelWeekday(probe)

  // זמן מדויק לבדיקת מינימום שעות מראש (רק אם time סופק ותקין) — אם לא,
  // לא בודקים את המגבלה הזו בכלל (שמרני, כמו שאר הפונקציה)
  const scheduledAt = time ? israelDateTime(dateISO, time) : null

  return qualified.some(uid => {
    const sched = employeeSchedules[uid]
    const dayOk = !sched?.length || (() => {
      const entry = sched.find(d => d.day === dayName)
      return !entry || !entry.closed
    })()
    if (!dayOk) return false
    if (scheduledAt && !meetsMinLeadTime(scheduledAt, uid, employeeMinLeadHours)) return false
    return true
  })
}

export type SlotAvailabilityCheck =
  | { status: 'unknown' } // אין מספיק מידע כדי לבדוק (שירות/שיוך לא ידועים) — לא חוסמים
  | { status: 'available'; doctorId: string }
  | { status: 'unavailable' } // יש שיוך ברור לשירות, אבל אף רופא/ה מוסמכ/ת לא פנוי/ה בפועל בשעה הזו

// ─── בדיקת זמינות אמיתית **כולל שעה מדויקת**, לפני שהצעה נשלחת ללקוח ────────
// (יוסי, 31/08): hasQualifiedDoctorOnDate למעלה בודקת רק "עובד/ת ביום הזה"
// (לפי employee_schedules) — לא אם השעה הספציפית שהוצעה כבר תפוסה אצל אותו
// רופא/ה. זו הפונקציה שסוגרת את הפער: אותה סינון מועמדים (שירות+יום+
// min-lead) כמו hasQualifiedDoctorOnDate, ואז קריאה ל-pickAvailableDoctor —
// **אותה פונקציה בדיוק** שמשמשת את הקביעה האמיתית (saveOrRescheduleBotAppointment)
// — כדי לבדוק חפיפה מול appointments אמיתיים. Read-only: לא כותבת כלום,
// לא שומרת/מזמינה slot — רק שאלה "מי פנוי/ה עכשיו בפועל"
export async function findAvailableDoctorForExactSlot(
  sb: any, businessId: string,
  dateISO: string, time: string, durationMinutes: number,
  service: string | null | undefined,
  empResponsibilities: Record<string, string[]>,
  employeeSchedules: Record<string, WorkingDay[]>,
  employeeMinLeadHours?: Record<string, number>
): Promise<SlotAvailabilityCheck> {
  if (!service || Object.keys(empResponsibilities).length === 0) return { status: 'unknown' }
  let qualified = Object.entries(empResponsibilities)
    .filter(([, svcs]) => svcs.some(s => service.includes(s) || s.includes(service)))
    .map(([uid]) => uid)
  if (qualified.length === 0) return { status: 'unknown' }

  const scheduledAt = israelDateTime(dateISO, time)
  if (!scheduledAt) return { status: 'unknown' }
  const dayName = israelWeekday(scheduledAt)

  qualified = qualified.filter(uid => {
    const sched = employeeSchedules[uid]
    const dayOk = !sched?.length || (() => {
      const entry = sched.find(d => d.day === dayName)
      return !entry || !entry.closed
    })()
    if (!dayOk) return false
    if (!meetsMinLeadTime(scheduledAt, uid, employeeMinLeadHours)) return false
    return true
  })
  if (qualified.length === 0) return { status: 'unavailable' }

  const picked = await pickAvailableDoctor(sb, businessId, qualified, scheduledAt, durationMinutes)
  return picked ? { status: 'available', doctorId: picked } : { status: 'unavailable' }
}

// ─── האם הודעת הלקוח **הנוכחית** נראית כבקשה לתאריך/שעה חדשים? ─────────────
// קרה בפועל (יוסי, 19/08): הלקוח שאל "למי?" (שאלה כללית, לא קשורה לתאריך)
// והמודל, מבלי שנתבקש, "הזה" בתשובתו אישור-תור ישן משיחת בדיקה קודמת
// באותו thread (תאריך אחר לגמרי). extractApptFromText תפס את זה כתגובה
// אמיתית ו-saveOrRescheduleBotAppointment **הזיז בשקט** תור אמיתי שכבר
// קבוע ללקוח לתאריך שגוי — בלי שהלקוח ביקש לשנות כלום. המקרה המקורי
// שה-fallback הזה נבנה בשבילו (המודל אישר תור חדש בפרוזה בלי לכתוב APPT)
// תמיד מגיע אחרי שהלקוח בעצמו הציע/אישר תאריך/שעה בהודעה הזו או בסמוכה
// לה — לא משום מקום. אם ההודעה הנוכחית של הלקוח לא מכילה שום רמז
// לתאריך/שעה/יום/אישור, כנראה שהמודל רק "נזכר" ולא באמת קובע משהו חדש
const RESCHEDULE_INTENT_WORDS = ['כן', 'מתאים', 'בסדר', 'מעולה', 'סבבה', 'אוקיי', 'או קיי', 'נהדר', 'מצוין', 'תזיז', 'תדחה', 'תעביר', 'לשנות', 'להזיז', 'לדחות']
const HEB_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
export function looksLikeSchedulingReply(text: string): boolean {
  if (!text) return false
  if (/\d{1,2}[./]\d{1,2}([./]\d{2,4})?/.test(text)) return true // תאריך מפורש
  if (/\d{1,2}:\d{2}/.test(text)) return true // שעה מפורשת
  if (HEB_DAY_NAMES.some(d => text.includes(d))) return true // שם יום
  if (text.includes('מחר') || text.includes('היום') || text.includes('מחרתיים') || text.includes('בעוד')) return true
  if (RESCHEDULE_INTENT_WORDS.some(w => text.includes(w))) return true
  return false
}

export async function saveOrRescheduleBotAppointment(sb: any, params: {
  businessId: string
  leadId: string | null
  patientName: string
  patientPhone: string
  date: string
  time: string
  service?: string | null
  secondaryService?: string | null
  services?: { name: string; duration?: string | number }[]
  empResponsibilities?: Record<string, string[]>
  workingHours?: WorkingDay[]
  employeeSchedules?: Record<string, WorkingDay[]>
  // מינימום שעות מראש שנדרש לתיאום תור אצל כל רופא/ה (uid → שעות), 0/לא
  // מוגדר = בלי מגבלה — למשל רופא שצריך לראות תיק/הפניה לפני שהוא מגיע
  employeeMinLeadHours?: Record<string, number>
  // תאריכים שהעסק סגור בהם (חג/חופשה, מוגדר בהגדרות) — נאכף כאן, לא רק
  // כהקשר בפרומפט
  businessExceptions?: { date: string; reason: string }[]
  // רופא/ה שהבוט כבר הזכיר/ה בשם ללקוח קודם בשיחה (ראה extractMentionedDoctorId
  // ב-ai-respond/route.ts) — מכובד/ת אם עדיין מוסמך/ת, כדי שהאישור הסופי
  // לא יסתור את מה שכבר נאמר ללקוח
  preferredDoctorId?: string | null
}): Promise<BotApptResult> {
  const { businessId, leadId, patientName, patientPhone, date, time } = params
  const service = (params.service && params.service !== 'null' && params.service !== 'טיפול') ? params.service : null
  const secondaryService = (params.secondaryService && params.secondaryService !== service && params.secondaryService !== 'אחר') ? params.secondaryService : null

  // 1. נרמול תאריך ושעה
  const normDate = normalizeApptDate(date)
  if (!normDate) return { ok: false, error: 'unparseable_date', details: { date, time } }

  let scheduledAt = israelDateTime(normDate, time)
  if (!scheduledAt) return { ok: false, error: 'invalid_datetime', details: { normDate, time } }

  // תיקון תאריך בעבר — שני ניסיונות תיקון אוטומטיים לפני כישלון מפורש:
  const nowMs = Date.now()
  let dateRolledForward = false
  if (scheduledAt.getTime() < nowMs - 60 * 60 * 1000) {
    // ניסיון 1: שנה שגויה מהמודל (למשל 2024 במקום 2026) — רק תיקון לשנה הנוכחית
    const yearFixed = new Date(scheduledAt)
    yearFixed.setFullYear(new Date().getFullYear())

    // ניסיון 2: "יום ראשון 9:00" בלי "הבא", כשראשון של השבוע הזה כבר עבר —
    // הכוונה כמעט תמיד לאותו יום/שעה בשבוע הבא, לא לבקש הבהרה. קפיצה של
    // בדיוק 7 ימים קדימה שומרת על אותו יום בשבוע ואותה שעה בדיוק.
    const weekFixed = new Date(scheduledAt.getTime() + 7 * 86400000)

    if (yearFixed.getTime() >= nowMs - 60 * 60 * 1000) {
      scheduledAt = yearFixed
    } else if (weekFixed.getTime() >= nowMs - 60 * 60 * 1000) {
      console.log('[botAppointments] date was in the past — rolled forward 7 days to next occurrence of the same weekday/time:', scheduledAt.toISOString(), '->', weekFixed.toISOString())
      scheduledAt = weekFixed
      dateRolledForward = true
    } else {
      return { ok: false, error: 'date_in_past', details: { requested: scheduledAt.toISOString(), now: new Date(nowMs).toISOString() } }
    }
  }

  // תקרת עתיד: תאריך רחוק מדי = הזיה של המודל, לא תור אמיתי
  if (scheduledAt.getTime() > nowMs + MAX_DAYS_AHEAD * 86400000) {
    return { ok: false, error: 'date_too_far', details: { requested: scheduledAt.toISOString(), maxDaysAhead: MAX_DAYS_AHEAD } }
  }

  // שעת פעילות: הפרומפט מקבל את הטבלה כהקשר בלבד, לא כאכיפה — כאן האכיפה
  // האמיתית, ברמת המסד, בלי תלות בכך שהמודל יזכור/יישם נכון
  const hoursCheck = checkWithinWorkingHours(scheduledAt, time, params.workingHours)
  if (!hoursCheck.ok) {
    return { ok: false, error: 'outside_working_hours', details: hoursCheck }
  }

  // ימי סגירה (חג/חופשה): עד עכשיו הפרומפט קיבל את זה רק כהקשר ("אל תציע
  // תורים בתאריכים האלה"), בלי שום אכיפה בקוד — בדיוק כמו הפער שהיה קודם
  // בשעות פעילות. אם המודל בכל זאת מאשר תור ביום סגור, זה נשמר כתקין לגמרי.
  // אותה שכבת אכיפה קשיחה כמו שעות פעילות, בלי תלות בזיכרון/דיוק המודל
  const closedException = (params.businessExceptions || []).find(e => e.date === normDate)
  if (closedException) {
    return { ok: false, error: 'business_closed', details: { date: normDate, reason: closedException.reason } }
  }

  const targetISO = scheduledAt.toISOString()

  // משך וטיפול משויך
  const matchedService = (params.services || []).find(s => service && s.name?.includes(service))
  const duration = matchedService?.duration ? parseInt(String(matchedService.duration)) : 60

  // שיוך רופא: כשכמה רופאים מתאימים לאותו שירות, לא בוחרים תמיד את אותו
  // אחד (זה היה הבאג הישן — פשוט הראשון ב-object). בוחרים לפי מי פנוי
  // בזמן המבוקש, ואם כמה פנויים — לפי מי שכי הכי פחות עמוס (רוטציה הוגנת)
  let assignedTo: string | null = null
  // true = יש רופא/ה שמוסמכ/ת לטיפול הזה, אבל אף אחד/ת לא זמין/ה בפועל
  // (סגור/ה באותו יום או תפוס/ה באותה שעה בדיוק) — לדחות את הקביעה, לא
  // "לקבוע בכל זאת". שונה מ"אין בכלל מי שמטפל בשירות הזה" (assignedTo
  // נשאר null בלי דחייה — פער תצורה בעסק, לא בעיית זמינות)
  let noDoctorAvailable = false
  const resp = params.empResponsibilities || {}
  if (service && Object.keys(resp).length > 0) {
    let qualified = Object.entries(resp)
      .filter(([, svcs]) => (svcs as string[]).some(s => service.includes(s) || s.includes(service)))
      .map(([uid]) => uid)

    // אם לליד יש גם סיבת פנייה קונקרטית מזוהה (matchServiceReason ב-botTags.ts)
    // שונה מ-service הכללי שהמודל כתב בתגית APPT (למשל service="אבחון" אבל
    // הליד עצמו הוא בקשה ל"השתלות") — מצמצמים לרופאים שמוסמכים גם לשירות
    // הספציפי הזה. קרה בפועל: פגישת "אבחון" שויכה לרופא שכן עושה אבחונים
    // אך לא עושה שתלים בכלל, כי ה-APPT tag לא ציין את הטיפול הספציפי.
    // אם החיתוך ריק — לא חוסמים לגמרי (עדיף רופא כללי מאשר לדחות תור מוסכם)
    if (secondaryService) {
      const qualifiedSecondary = Object.entries(resp)
        .filter(([, svcs]) => (svcs as string[]).some(s => secondaryService.includes(s) || s.includes(secondaryService)))
        .map(([uid]) => uid)
      const intersection = qualified.filter(uid => qualifiedSecondary.includes(uid))
      if (intersection.length > 0) qualified = intersection
    }

    const qualifiedBeforeAvailability = qualified

    // לא מציעים רופא/ה שסגור/ה באותו יום לפי הלוח האישי שלו/ה (employee_schedules,
    // נפרד משעות הפעילות הכלליות של העסק שכבר נבדקו למעלה). קרה בפועל
    // (יוסי, 19/08): רופא שסגר את כל ימי העבודה שלו עדיין קיבל תור, כי
    // כשאף אחד לא היה "זמין היום" הקוד חזר לרשימה המלאה במקום לדחות.
    // עכשיו: סינון אמיתי, בלי נפילה חזרה לרשימה הלא-מסוננת
    if (params.employeeSchedules) {
      qualified = qualified.filter(uid => {
        const sched = params.employeeSchedules?.[uid]
        if (!sched?.length) return true // אין לוח אישי מוגדר — לא חוסמים
        return checkWithinWorkingHours(scheduledAt, time, sched).ok
      })
    }

    // מינימום שעות מראש: רופא/ה שהוגדרה לו/ה דרישת "X שעות מראש" ולא
    // עומדים בה כרגע — לא מוצע/ת, בדיוק כמו יום סגור. אותו עיקרון של
    // זמינות אמיתית בלבד, לא רק ימי עבודה
    if (params.employeeMinLeadHours) {
      qualified = qualified.filter(uid => meetsMinLeadTime(scheduledAt, uid, params.employeeMinLeadHours))
    }

    if (qualified.length > 0) {
      // קרה בפועל: כששני רופאים מוסמכים לאותו שירות, הבוט הזכיר בשיחה שם
      // רופא/ה ספציפי/ת ללקוח ("יש לנו תור עם ד"ר X"), אבל שיוך הרופא
      // בפועל (רוטציה לפי עומס) בחר רופא/ה **אחר/ת** לגמרי. מנסים לכבד
      // את מי שכבר הובטח קודם — אבל רק אם הוא/היא גם באמת פנוי/ה עכשיו
      // (לא תפוס/ה בדיוק בשעה הזו), לא סתם כי הוזכר/ה
      if (params.preferredDoctorId && qualified.includes(params.preferredDoctorId)) {
        assignedTo = await pickAvailableDoctor(sb, businessId, [params.preferredDoctorId], scheduledAt, duration)
      }
      if (!assignedTo) {
        assignedTo = await pickAvailableDoctor(sb, businessId, qualified, scheduledAt, duration)
      }
    }

    if (!assignedTo && qualifiedBeforeAvailability.length > 0) {
      noDoctorAvailable = true
    }
  }

  if (noDoctorAvailable) {
    return { ok: false, error: 'no_doctor_available', details: { date: normDate, time } }
  }

  try {
    // 2. חפש תור עתידי קיים של הלקוח — אם יש, זו הזזה (reschedule), לא יצירה.
    // לפי patient_phone (לא lead_id): תור שסונכרן מאופטימה יכול להיות בלי
    // קישור ליד בכלל (sync-optima מקשר ליד רק אם הוא כבר קיים באותו רגע) —
    // חיפוש לפי leadId בלבד היה מפספס אותו ויוצר תור כפול/סותר במקום
    // להזיז את הקיים (יוסי, 25/08: "הוא חייב לחפש ליטרלי ביומן לפי טלפון")
    const { data: existingData } = await sb.from('appointments')
      .select('id, scheduled_at')
      .eq('business_id', businessId)
      .eq('patient_phone', patientPhone)
      .gte('scheduled_at', new Date().toISOString())
      .in('status', ['scheduled', 'confirmed'])
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const existing: { id: string; scheduled_at: string } | null = existingData || null

    if (existing) {
      const oldISO = new Date(existing.scheduled_at).toISOString()

      // אותו זמן בדיוק — אין מה לעדכן (מונע כפילות בניסיון חוזר)
      if (oldISO === targetISO) {
        const rb = await readBack(sb, existing.id, targetISO)
        return rb.ok
          ? { ok: true, action: 'unchanged', id: existing.id, oldTime: oldISO, newTime: targetISO, verifiedAt: rb.verifiedAt, dateRolledForward, assignedTo, durationMinutes: isNaN(duration) ? 60 : duration }
          : rb
      }

      // ─── הזזת תור: UPDATE על השורה הקיימת ───
      const updatePayload: Record<string, unknown> = { scheduled_at: targetISO }
      if (service) updatePayload.treatment_type = service
      if (assignedTo) updatePayload.assigned_to = assignedTo
      const { error: updErr } = await sb.from('appointments')
        .update(updatePayload)
        .eq('id', existing.id)

      if (updErr) {
        return { ok: false, error: 'update_failed', id: existing.id, oldTime: oldISO, newTime: targetISO, details: { supabase: updErr } }
      }

      const rb = await readBack(sb, existing.id, targetISO)
      if (!rb.ok) return { ...rb, oldTime: oldISO, newTime: targetISO }
      return { ok: true, action: 'rescheduled', id: existing.id, oldTime: oldISO, newTime: targetISO, verifiedAt: rb.verifiedAt, dateRolledForward, assignedTo, durationMinutes: isNaN(duration) ? 60 : duration }
    }

    // ─── יצירת תור חדש ───
    // מניעת כפילות: תור זהה (טלפון + זמן) כבר קיים → החזר אותו
    const { data: dup } = await sb.from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .eq('patient_phone', patientPhone)
      .eq('scheduled_at', targetISO)
      .maybeSingle()

    if (dup) {
      const rb = await readBack(sb, dup.id, targetISO)
      return rb.ok
        ? { ok: true, action: 'unchanged', id: dup.id, oldTime: targetISO, newTime: targetISO, verifiedAt: rb.verifiedAt, dateRolledForward, assignedTo, durationMinutes: isNaN(duration) ? 60 : duration }
        : rb
    }

    const { data: inserted, error: insErr } = await sb.from('appointments')
      .insert({
        business_id: businessId,
        lead_id: leadId,
        patient_name: patientName,
        patient_phone: patientPhone,
        treatment_type: service,
        scheduled_at: targetISO,
        duration_minutes: isNaN(duration) ? 60 : duration,
        status: 'scheduled',
        notes: 'נקבע אוטומטית על ידי הבוט',
        assigned_to: assignedTo,
      })
      .select('id')
      .single()

    if (insErr || !inserted?.id) {
      return { ok: false, error: 'insert_failed', newTime: targetISO, details: { supabase: insErr } }
    }

    const rb = await readBack(sb, inserted.id, targetISO)
    if (!rb.ok) return { ...rb, newTime: targetISO }
    return { ok: true, action: 'created', id: inserted.id, oldTime: null, newTime: targetISO, verifiedAt: rb.verifiedAt, dateRolledForward, assignedTo, durationMinutes: isNaN(duration) ? 60 : duration }

  } catch (e: unknown) {
    return { ok: false, error: 'exception', newTime: targetISO, details: { message: e instanceof Error ? e.message : String(e) } }
  }
}

// 3. Read-back: קרא את השורה מהמסד וודא שהזמן שנשמר תואם במדויק לזמן שהתבקש
async function readBack(sb: any, id: string, expectedISO: string): Promise<BotApptResult> {
  const { data: row, error } = await sb.from('appointments')
    .select('id, scheduled_at, status')
    .eq('id', id)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: 'readback_not_found', id, details: { supabase: error } }
  }
  const actualISO = new Date(row.scheduled_at).toISOString()
  if (actualISO !== expectedISO) {
    return { ok: false, error: 'readback_mismatch', id, details: { expected: expectedISO, actual: actualISO } }
  }
  return { ok: true, id, verifiedAt: actualISO }
}
