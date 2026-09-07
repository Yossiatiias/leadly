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
// (יוסי, 01/09): נמצא בפועל — 11:00 חזר כ-"פנוי" מ-findAvailableSlots כשהשעה
// האמיתית כבר הייתה 12:09. שורש הבעיה: minHours=0/undefined גרם ל-`return
// true` **בלי שום בדיקה** שה-slot בכלל בעתיד — הבדיקה נגד "עבר" הייתה
// קיימת רק כתופעת לוואי של בדיקת min-lead-hours, ובוטלה לגמרי כשלא הוגדר
// min-lead. כלל עסקי מפורש עכשיו: עם min-lead — >= now+minHours; בלי
// min-lead — > now בלבד. לעולם לא slot בעבר, בלי קשר לשעות מרפאה/רופא/
// appointments (אלה כולם נבדקים בנפרד, למעלה/מתחת לקריאה הזו)
function meetsMinLeadTime(scheduledAt: Date, uid: string, employeeMinLeadHours?: Record<string, number>): boolean {
  const minHours = employeeMinLeadHours?.[uid]
  if (!minHours) return scheduledAt.getTime() > Date.now()
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

export type ServiceDoctorAvailabilityStatus = 'no_match' | 'unverified' | 'fully_blocked' | 'has_calendar'

// ─── שיוך שירות→רופא/ה מול "יש בכלל יומן פתוח" — לא "יש slot היום" ──────────
// (דרישה עסקית): closed:true בלוח האישי של רופא/ה הוא חסימת-קביעה-
// אוטומטית מכוונת (למשל מומחה שמתואם ידנית, לא דרך הבוט) — הוא לא אומר
// "השירות לא ניתן" ולא "אין תורים בכלל". לפני התיקון הזה, hasQualifiedDoctorOnDate/
// findAvailableSlots פשוט חזרו "אין זמינות" בשני מקרים שונים לגמרי (אין
// רופא/ה משויכ/ת בכלל, לעומת יש רופא/ה משויכ/ת אבל בלי יומן פתוח), וה-route
// לא יכול היה להבחין ביניהם כדי לבחור את הניסוח הנכון. הפונקציה הזו עונה
// רק על "האם יש בכלל בסיס לחפש שעות אוטומטית לשירות הזה":
//
// (ביקורת קוד) ⚠️ ארבעה status אמיתיים, ורק אחד מהם "אימות" מלא —
// unverified הוא status רביעי, נפרד מפורשות מ-has_calendar (לא מתחזה
// לאימות שלא בוצע בפועל):
//   1) שירות משויך לרופא/ה עם יומן פתוח מאומת → has_calendar. ✅ אימות מלא —
//      **היחיד** שמתיר קביעה/הצעה אוטומטית ב-strict mode (ר' route.ts).
//   2) השירות קיים, אבל אין אף רופא/ה משויכ/ת אליו כלל (empResponsibilities
//      לא ריק, אבל אין שורה מתאימה) → no_match.
//   3) empResponsibilities **ריק/חסר לגמרי** עבור העסק (אין שום שיוך שירותים
//      מוגדר, לאף שירות) → unverified. אין שום נתון לאמת מולו.
//   4) יש רופא/ה משויכ/ת, אבל **אין לאף אחד/ת מהם/ן employee_schedules
//      מוגדר בכלל** (המפתח חסר, לא [] ריק) → unverified — לא ניתן לאמת
//      יומן פתוח, גם אם אין שום סיבה לחשוב שהוא סגור.
//   5) יש רופא/ה משויכ/ת, ולפחות אחד/ת מהם/ן יש employee_schedules מוגדר,
//      אבל **כולם** (מי שיש להם לוח בכלל) closed בכל הימים → fully_blocked.
// עדיפות בין רופאים מרובים לאותו שירות: אם **לפחות אחד/ת** מהם/ן מאומת/ת
// כפתוח/ה (מקרה 1) — מוחזר has_calendar (עדיפות עליונה, זמינות אמיתית
// קיימת). אחרת, אם **לפחות אחד/ת** אין לו/ה לוח בכלל (מקרה 4) — unverified
// (אי אפשר לשלול זמינות). רק אם **לכולם** יש לוח והם **כולם** סגורים —
// fully_blocked (מקרה 5, וידאנו בפועל שאין אף אחד פתוח).
//
// ⚠️ בידוד multi-tenant (ביקורת רביעית): שלושת המקרים 2/3/5 (no_match/
// unverified/fully_blocked) כולם מוחזרים כאן בלי תלות בשום דגל — זו רק
// פונקציית-סיווג טהורה. **האם** התוצאה בכלל משפיעה על ההתנהגות נקבע אך
// ורק ב-route.ts (shouldForceHandoff), שגודר במלואו מאחורי business.
// settings.strict_service_doctor_booking===true. בלי הדגל — אף אחד
// מארבעת ה-status לא חוסם שום דבר, וההתנהגות הישנה (findAvailableSlots/
// hasQualifiedDoctorOnDate/NO_AVAILABILITY_MESSAGE, שלא נגעתי בהם) ממשיכה
// לרוץ בדיוק כמו לפני כל התכונה הזו, לכל עסק שלא הגדיר את הדגל
const HEB_WEEKDAYS = new Set(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])

function isValidHHMM(t: unknown): t is string {
  return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t)
}
function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ─── שורת לוח שבאמת אפשר לסמוך עליה כ"יום פתוח מאומת" ───────────────────────
// (ביקורת קוד): closed:false לבד לא מספיק — שורה עם יום לא תקין, או בלי
// שעות פתיחה/סגירה תקינות, או עם close<=open (נתונים פגומים) היא לא הוכחה
// אמיתית ל"יש כאן יומן פתוח", גם אם מישהו/הי לא סימן/ה אותה closed:true.
// כזו נחשבת "לא ניתנת לאימות" (unverified), לא "פתוחה" וגם לא "סגורה"
function isUsableOpenScheduleRow(row: { day?: string; open?: string; close?: string; closed?: boolean } | null | undefined): boolean {
  if (!row) return false
  if (row.closed === true) return false
  if (!row.day || !HEB_WEEKDAYS.has(row.day)) return false
  if (!isValidHHMM(row.open) || !isValidHHMM(row.close)) return false
  return hhmmToMinutes(row.close) > hhmmToMinutes(row.open)
}

export function getServiceDoctorAvailabilityStatus(
  service: string | null | undefined,
  empResponsibilities: Record<string, string[]>,
  employeeSchedules: Record<string, { day: string; open?: string; close?: string; closed: boolean }[]>
): ServiceDoctorAvailabilityStatus {
  if (!service) return 'no_match'
  if (Object.keys(empResponsibilities).length === 0) return 'unverified'
  const qualified = Object.entries(empResponsibilities)
    .filter(([, svcs]) => svcs.some(s => service.includes(s) || s.includes(service)))
    .map(([uid]) => uid)
  if (qualified.length === 0) return 'no_match'

  let anyUnverified = false
  for (const uid of qualified) {
    const sched = employeeSchedules[uid]
    if (!sched?.length) { anyUnverified = true; continue }
    for (const row of sched) {
      if (row.closed === true) continue // מסומן סגור במפורש — עובדה אמיתית, לא unverified
      if (isUsableOpenScheduleRow(row)) return 'has_calendar' // עדיפות עליונה — יומן פתוח מאומת בפועל
      // closed !== true, אבל השורה פגומה/חסרה (יום לא תקין, שעות חסרות/פסולות,
      // close<=open) — אי אפשר לדעת אם זה באמת פתוח, לא נחשב "מאומת סגור"
      anyUnverified = true
    }
  }
  return anyUnverified ? 'unverified' : 'fully_blocked'
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

export interface AvailableSlot { date: string; time: string; doctorId: string }

// ─── מציאת שעות פנויות אמיתיות ביום נתון — לא רק בדיקת שעה אחת בודדת ────────
// (יוסי, 01/09): עד כה המערכת ידעה רק CHECK EXACT SLOT ("האם 10:30 פנוי?",
// findAvailableDoctorForExactSlot למעלה) — לא FIND AVAILABLE SLOTS ("אילו
// שעות פנויות יש ביום X?"). קרה בפועל: לקוח שנדחה על שעה ספציפית ביקש
// "תרשום לי מתי פנוי" — לבוט לא היה שום מקור אמת לענות (אסור לו להמציא
// שעה), ובלית ברירה נפל תמיד להעברה לנציג, גם כשבפועל היו שעות פנויות
// אמיתיות ביומן. הפונקציה הזו סוגרת את הפער: אותו סינון בדיוק כמו
// findAvailableDoctorForExactSlot (שירות → מוסמכים → עובד/ת ביום → min-lead),
// ואז בונה רשת שעות מתוך שעות הפתיחה/סגירה האישיות של כל רופא/ה
// (employee_schedules, open/close בפועל — לא רק "עובד/סגור"), מסננת חפיפה
// מול appointments אמיתיים (אותה שאילתה כמו pickAvailableDoctor), וממזגת
// בין רופאים כדי לא להציג אותה שעה פעמיים. Read-only: לא כותבת/שומרת כלום.
// preferredDoctorId, אם סופק, מצמצם את כל החיפוש לרופא/ה הזה/ו בלבד —
// לעולם לא מציעים תחליף בשקט למי שהלקוח ביקש בשם (אותו עיקרון כמו
// extractCustomerRequestedDoctorId/textMentionsWrongDoctor באסקלציה למעלה)
export async function findAvailableSlots(
  sb: any, businessId: string,
  dateISO: string,
  service: string | null | undefined,
  empResponsibilities: Record<string, string[]>,
  employeeSchedules: Record<string, WorkingDay[]>,
  employeeMinLeadHours: Record<string, number> | undefined,
  durationMinutes: number,
  preferredDoctorId?: string | null,
  maxResults = 4,
  // שעות הפעילות הכלליות של המרפאה (working_hours_table) — נפרד מהלוח
  // האישי של כל רופא/ה. פרמטר אופציונלי בסוף (לא שובר call sites קיימים):
  // אם לא סופק, ההתנהגות זהה בדיוק לקודם (רק הלוח האישי נבדק). כשכן סופק,
  // חלון השעות של כל רופא/ה מצטמצם לחיתוך בין הלוח האישי לשעות המרפאה —
  // קרה בפועל: רופא מוגדר עד 19:00 אבל המרפאה סגורה מ-17:00, ובלי החיתוך
  // הזה findAvailableSlots הייתה מציעה שעות שהמרפאה עצמה סגורה בהן
  businessWorkingHours?: WorkingDay[]
): Promise<AvailableSlot[]> {
  // fail-closed: בלי שירות ידוע ובלי שיוך רופאים בעסק, אין שום בסיס אמיתי
  // להציע שעות — לא מנחשים (אותו עיקרון כמו resolveActiveService ב-botTags.ts
  // וה-fail-closed שנוסף ב-route.ts, 31/08 — מקרה ד"ר גבי סמל)
  if (!service || Object.keys(empResponsibilities).length === 0) return []

  let qualified = Object.entries(empResponsibilities)
    .filter(([, svcs]) => svcs.some(s => service.includes(s) || s.includes(service)))
    .map(([uid]) => uid)
  if (qualified.length === 0) return []

  // הלקוח ביקש רופא/ה מסוים/ת בשם — מחפשים אך ורק אצלו/ה, לא מציעים תחליף
  if (preferredDoctorId) {
    qualified = qualified.includes(preferredDoctorId) ? [preferredDoctorId] : []
    if (qualified.length === 0) return []
  }

  const probe = new Date(`${dateISO}T12:00:00Z`)
  if (isNaN(probe.getTime())) return []
  const dayName = israelWeekday(probe)

  // המרפאה סגורה כל היום הזה — אין שום slot, בלי קשר ללוח האישי של אף רופא/ה
  const businessDayEntry = businessWorkingHours?.find(d => d.day === dayName)
  if (businessWorkingHours?.length && (!businessDayEntry || businessDayEntry.closed || !businessDayEntry.open || !businessDayEntry.close)) return []

  // רק רופאים עם לוח אישי מוגדר ובעל שעות פתיחה/סגירה אמיתיות ביום הזה —
  // בלי לוח אישי (employeeSchedules[uid] ריק) אי אפשר לבנות רשת שעות
  // אמיתית בכלל, אז לא מנחשים שעות ברירת מחדל; פשוט מדלגים על הרופא הזה.
  // כשיש גם שעות מרפאה — מצמצמים לחיתוך (מאוחר מבין ה-open, מוקדם מבין ה-close)
  const doctorHours: Record<string, WorkingDay> = {}
  for (const uid of qualified) {
    const sched = employeeSchedules[uid]
    if (!sched?.length) continue
    const entry = sched.find(d => d.day === dayName)
    if (!entry || entry.closed || !entry.open || !entry.close) continue
    let { open, close } = entry
    if (businessDayEntry?.open && businessDayEntry?.close) {
      open = open > businessDayEntry.open ? open : businessDayEntry.open
      close = close < businessDayEntry.close ? close : businessDayEntry.close
      if (open >= close) continue // אין חפיפה בין שעות הרופא/ה לשעות המרפאה ביום הזה
    }
    doctorHours[uid] = { day: dayName, open, close, closed: false }
  }
  const openDoctors = Object.keys(doctorHours)
  if (openDoctors.length === 0) return []

  const dayStart = israelDateTime(dateISO, '00:00')
  const dayEnd = israelDateTime(dateISO, '23:59')
  if (!dayStart || !dayEnd) return []

  const { data: dayAppts } = await sb.from('appointments')
    .select('assigned_to, scheduled_at, duration_minutes')
    .eq('business_id', businessId)
    .in('assigned_to', openDoctors)
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_at', dayStart.toISOString())
    .lte('scheduled_at', dayEnd.toISOString())

  const apptsByDoctor: Record<string, { start: number; end: number }[]> = {}
  for (const uid of openDoctors) apptsByDoctor[uid] = []
  for (const a of (dayAppts || []) as { assigned_to: string; scheduled_at: string; duration_minutes: number | null }[]) {
    if (!apptsByDoctor[a.assigned_to]) continue
    const start = new Date(a.scheduled_at).getTime()
    apptsByDoctor[a.assigned_to].push({ start, end: start + (a.duration_minutes || 60) * 60000 })
  }

  // רשת שעות מועמדות לכל רופא/ה, בקפיצות של משך הטיפול עצמו, בתוך שעות
  // הפתיחה/סגירה האישיות שלו/ה בלבד — לא מעבר לזמן שהטיפול נגמר בדיוק בסגירה
  const doctorSlotTimes: Record<string, Set<string>> = {}
  const candidateTimes = new Set<string>()
  for (const uid of openDoctors) {
    const { open, close } = doctorHours[uid]
    const [oh, om] = open.split(':').map(Number)
    const [ch, cm] = close.split(':').map(Number)
    const closeMin = ch * 60 + cm
    doctorSlotTimes[uid] = new Set()
    for (let cursor = oh * 60 + om; cursor + durationMinutes <= closeMin; cursor += durationMinutes) {
      const t = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`
      doctorSlotTimes[uid].add(t)
      candidateTimes.add(t)
    }
  }

  const sortedTimes = Array.from(candidateTimes).sort()
  const results: AvailableSlot[] = []

  for (const time of sortedTimes) {
    if (results.length >= maxResults) break
    // סדר קבוע (qualified, לא Object.keys(doctorHours) שאינו מובטח יציב) —
    // אותו רופא/ה נבחר/ת באופן דטרמיניסטי בכל הרצה לאותה שעה, לא רנדומלי,
    // וכשאותה שעה פנויה אצל כמה רופאים בלי העדפת לקוח — לא מוצגת פעמיים
    for (const uid of qualified) {
      if (!doctorSlotTimes[uid]?.has(time)) continue
      const scheduledAt = israelDateTime(dateISO, time)
      if (!scheduledAt) continue
      if (!meetsMinLeadTime(scheduledAt, uid, employeeMinLeadHours)) continue
      const slotStart = scheduledAt.getTime()
      const slotEnd = slotStart + durationMinutes * 60000
      const busy = apptsByDoctor[uid].some(a => slotStart < a.end && slotEnd > a.start)
      if (busy) continue
      results.push({ date: dateISO, time, doctorId: uid })
      break
    }
  }
  return results
}

// ─── GENERAL NEXT AVAILABLE — "מתי יש לכם?"/"מתי פנוי?" בלי יום ספציפי ──────
// (יוסי, 01/09): findAvailableSlots למעלה דורשת תאריך קונקרטי. כשהלקוח לא
// נתן יום בכלל ("מתי יש לכם?"), resolveActiveRequestedDate מחזירה null,
// וכל היכולת מדלגת — קרה בפועל: הבוט נפל לתשובת ברירת המחדל הישנה ("לא
// מצאתי תור זמין") גם כשבפועל הייתה זמינות אמיתית תוך יומיים-שלושה. הפונקציה
// הזו לא בונה שום לוגיקת זמינות חדשה — היא רק **עוטפת** את findAvailableSlots
// הקיימת (ללא שינוי בה) בלולאה שסורקת יום-יום קדימה, ועוצרת ברגע שנאספו
// maxResults slots אמיתיים או שנגמר הטווח. כל תנאי ה"פנוי באמת" (שירות,
// שיוך רופא, לוח אישי, min-lead, חפיפת appointments, duration מהגדרת
// השירות) כבר נאכפים בתוך findAvailableSlots עצמה, פעם אחת, לכל יום —
// אין כאן שום כפילות/גרסה מקבילה של אותה בדיקה
export async function findNextAvailableSlots(
  sb: any, businessId: string,
  startDateISO: string, // היום הראשון לבדיקה (בדרך כלל "היום" בשעון ישראל)
  daysAhead: number,
  service: string | null | undefined,
  empResponsibilities: Record<string, string[]>,
  employeeSchedules: Record<string, WorkingDay[]>,
  employeeMinLeadHours: Record<string, number> | undefined,
  durationMinutes: number,
  preferredDoctorId?: string | null,
  maxResults = 4,
  businessWorkingHours?: WorkingDay[]
): Promise<AvailableSlot[]> {
  // אותו fail-closed כמו findAvailableSlots — נבדק כאן גם כדי לא לבזבז
  // daysAhead שאילתות DB סתם כשאין שום בסיס אמיתי לחיפוש
  if (!service || Object.keys(empResponsibilities).length === 0) return []

  const anchor = new Date(`${startDateISO}T12:00:00Z`) // עוגן בצהריים, ראה nextDateForWeekday למעלה — אותה טכניקה, בלי בעיית חיתוך יום
  if (isNaN(anchor.getTime())) return []

  const results: AvailableSlot[] = []
  for (let i = 0; i < daysAhead && results.length < maxResults; i++) {
    const dateISO = new Date(anchor.getTime() + i * 86400000).toISOString().slice(0, 10)
    const daySlots = await findAvailableSlots(
      sb, businessId, dateISO, service,
      empResponsibilities, employeeSchedules, employeeMinLeadHours,
      durationMinutes, preferredDoctorId, maxResults - results.length, businessWorkingHours
    )
    results.push(...daySlots)
  }
  return results
}

// ─── פתרון "רביעי?"/"מה יש בשלישי?" לתאריך קונקרטי לפני חיפוש שעות ──────────
// findAvailableSlots דורשת תאריך מדויק, לא שם יום — הפונקציות האלה סוגרות
// את הפער בין מה שהלקוח כתב לבין מה ש-findAvailableSlots צריכה לקבל
const HEB_WEEKDAY_LIST = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// israelNow חייב כבר לכלול את היסט שעון ישראל (ראה israelDateISOOffset
// למעלה, ו-upcomingDatesText/israelNow ב-ai-respond/route.ts לאותה טכניקה —
// getUTCDay ולא israelWeekday, כדי לא "להזיז" את הזמן פעמיים)
export function nextDateForWeekday(israelNow: Date, weekdayHeb: string): string | null {
  const targetIdx = HEB_WEEKDAY_LIST.indexOf(weekdayHeb)
  if (targetIdx === -1) return null
  const offset = (targetIdx - israelNow.getUTCDay() + 7) % 7
  return israelDateISOOffset(israelNow, offset)
}

// מזהה תאריך מבוקש מטקסט בודד: מילת יחס ("מחר"), תאריך מפורש, או שם יום
// (כולל היום עצמו — אם היום שלישי והלקוח כתב "שלישי", הכוונה היא היום)
export function resolveDateMentionInText(text: string, israelNow: Date): string | null {
  if (!text) return null
  const relOffset = resolveRelativeDayOffset(text)
  if (relOffset !== null) return israelDateISOOffset(israelNow, relOffset)
  const dmy = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  for (const w of HEB_WEEKDAY_LIST) {
    if (text.includes(w)) return nextDateForWeekday(israelNow, w)
  }
  return null
}

// סורק את ההודעה הנוכחית, ואם לא נמצא בה תאריך — אחורה בהיסטוריה (כולל
// הודעות **יוצאות** של הבוט, לא רק נכנסות — קרה בפועל: הבוט שאל "מה מתאים
// לך ביום שלישי?" והלקוח ענה "תרשום לי מתי פנוי" בלי לחזור על היום עצמו.
// שונה בכוונה מ-resolveActiveService/extractCustomerRequestedDoctorId
// שסורקות רק inbound — שם השאלה היא "מה הלקוח בעצמו אמר", כאן השאלה היא
// "מה כבר פעיל/מדובר עליו בשיחה", וזה יכול להיות גם משהו שהבוט הציע
export function resolveActiveRequestedDate(
  currentText: string, messages: { content: string }[], israelNow: Date, maxLookback = 8
): string | null {
  const inCurrent = resolveDateMentionInText(currentText, israelNow)
  if (inCurrent) return inCurrent
  const start = Math.max(0, messages.length - maxLookback)
  for (let i = messages.length - 1; i >= start; i--) {
    const found = resolveDateMentionInText(messages[i].content, israelNow)
    if (found) return found
  }
  return null
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
  // (דרישה עסקית, strict mode) — ברירת מחדל false/undefined = בדיוק
  // ההתנהגות הקיימת, בלי שום שינוי (backward compatible לכל עסק שלא
  // מגדיר business.settings.strict_service_doctor_booking). כשמוגדר true:
  // קביעה אוטומטית מתאפשרת רק כשיש רופא/ה עם employee_schedules מאומת
  // ופתוח בפועל (getServiceDoctorAvailabilityStatus === 'has_calendar') —
  // no_match/unverified/fully_blocked כולם חוסמים, גם אם המצב הרגיל
  // (fail-open) היה מאפשר לקבוע בלי רופא/ה משויכ/ת בפועל
  strictServiceDoctorBooking?: boolean
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
    const strict = !!params.strictServiceDoctorBooking

    // לא מציעים רופא/ה שסגור/ה באותו יום לפי הלוח האישי שלו/ה (employee_schedules,
    // נפרד משעות הפעילות הכלליות של העסק שכבר נבדקו למעלה). קרה בפועל
    // (יוסי, 19/08): רופא שסגר את כל ימי העבודה שלו עדיין קיבל תור, כי
    // כשאף אחד לא היה "זמין היום" הקוד חזר לרשימה המלאה במקום לדחות.
    // עכשיו: סינון אמיתי, בלי נפילה חזרה לרשימה הלא-מסוננת
    if (params.employeeSchedules) {
      qualified = qualified.filter(uid => {
        const sched = params.employeeSchedules?.[uid]
        // (strict mode): בלי strict — אין לוח אישי מוגדר = לא חוסמים
        // (permissive, כמו תמיד). עם strict — בלי לוח אין דרך לאמת יומן
        // פתוח בפועל, אז לא נחשב/ת כשיר/ה (unverified, לא has_calendar)
        if (!sched?.length) return !strict
        return checkWithinWorkingHours(scheduledAt, time, sched).ok
      })
    } else if (strict) {
      // strict, אבל אין employeeSchedules בכלל בפרמטרים — אי אפשר לאמת שום דבר
      qualified = []
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

    // (strict mode): בלי strict — נחסם רק כשהיו רופאים מתאימים
    // לשירות (qualifiedBeforeAvailability) שהפכו ללא-זמינים (הישן, ללא
    // שינוי). עם strict — נחסם גם כש-qualifiedBeforeAvailability ריק
    // מלכתחילה (no_match: שירות ידוע, אבל אף רופא/ה לא משויכ/ת אליו) —
    // "אין אימות" חוסם תמיד ב-strict, לא רק "היה אימות ונכשל"
    if (!assignedTo && (strict || qualifiedBeforeAvailability.length > 0)) {
      noDoctorAvailable = true
    }
  } else if (params.strictServiceDoctorBooking) {
    // strict, אבל אין שירות ידוע בכלל, או שאין שום שיוך שירותים מוגדר
    // בעסק (empResponsibilities ריק) — אי אפשר לאמת דבר, לא קובעים בלי אימות
    noDoctorAvailable = true
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
