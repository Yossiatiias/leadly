// ─── פענוח תגיות המבנה שהמודל כותב בסוף כל תשובה ───────────────────────────
// LEAD:{...} / APPT:{...} / REMIND:{...} / GAP:[...] — כל התגיות האלה
// מנותקות מהטקסט שנשלח בפועל ללקוח (הלקוח לעולם לא רואה אותן).
// הלוגיקה כאן הועברה החוצה מ-ai-respond/route.ts כדי שאפשר יהיה לבדוק
// אותה בבדיקות אוטומטיות בלי לקרוא ל-OpenAI/Supabase בפועל.

export interface LeadAnalysis {
  name?: string | null
  reason?: string | null
  temperature?: string
  status?: string
}

export interface ApptData {
  date: string
  time: string
  service?: string | null
}

export interface RemindData {
  date: string
  time: string
}

export interface ParsedBotTags {
  leadAnalysis: LeadAnalysis | null
  apptData: ApptData | null
  remindData: RemindData | null
  gapQuestion: string | null
  escalationReason: string | null
  /** הטקסט הנקי, בלי אף תגית — זה מה שבאמת נשלח ללקוח */
  cleanResponse: string
}

function tryParseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export function parseBotTags(rawResponse: string): ParsedBotTags {
  const leadMatch = rawResponse.match(/LEAD:(\{[\s\S]*?\})/m)
  const leadAnalysis = tryParseJson<LeadAnalysis>(leadMatch?.[1])

  const apptMatch = rawResponse.match(/APPT:(\{[\s\S]*?\})/m)
  const apptData = tryParseJson<ApptData>(apptMatch?.[1])

  const remindMatch = rawResponse.match(/REMIND:(\{[\s\S]*?\})/m)
  const remindData = tryParseJson<RemindData>(remindMatch?.[1])

  const gapMatch = rawResponse.match(/GAP:\s*\[(.+?)\]/)
  const gapQuestion = gapMatch?.[1]?.trim() || null

  const escalateMatch = rawResponse.match(/ESCALATE:\s*\[(.+?)\]/)
  const escalationReason = escalateMatch?.[1]?.trim() || null

  const cleanResponse = rawResponse
    .replace(/\nLEAD:\{[\s\S]*?\}/m, '')
    .replace(/\nAPPT:\{[\s\S]*?\}/m, '')
    .replace(/\n?REMIND:\{[\s\S]*?\}/m, '')
    .replace(/\n?GAP:.*$/gm, '')
    .replace(/\n?ESCALATE:.*$/gm, '')
    .trim()

  return { leadAnalysis, apptData, remindData, gapQuestion, escalationReason, cleanResponse }
}

// ─── רשת ביטחון: הבטחה לנציג בטקסט בלי תגית ESCALATE ────────────────────────
// נבדק בפועל (17/08): המודל אמר ללקוח "אעביר אותך לנציג שלנו בהקדם" בדיוק
// כמו שהפרומפט מבקש, אבל לא צירף את תגית ESCALATE — בלעדיה שום דבר לא
// נשמר ב-DB והלקוח לא באמת קיבל שום מעקב. אותה גישה בדיוק כמו
// extractApptFromText ב-botAppointments.ts: אם המודל "הבטיח" בטקסט בלי
// לכתוב את התגית, תופסים את זה מהניסוח עצמו במקום לסמוך רק על התגית.
//
// נבדק בפועל שוב (25/08, לימור): רשימת ה-regex המדויקים הקודמת לא תפסה
// את הניסוח "אני מעביר את הבקשה לנציג שיחזור אליך בהקדם" — בדיוק אותה
// הודעה של NO_AVAILABILITY_MESSAGE! ("אעביר את הבקשה" != "אני מעביר את
// הבקשה", "הפנייה" != "הבקשה") — הלקוחה קיבלה הבטחה מפורשת בלי שום דגל
// "ממתין לנציג" בפועל. הוחלף בבדיקה רחבה (מילת "נציג" + פועל העברה/חזרה)
// שלא תלויה בניסוח מדויק — עדיף לתפוס יותר מדי מקרים (נציג בודק שיחה
// תקינה ומסיים) מאשר לפספס הבטחה אמיתית ללקוח
const REP_WORD = /נציג/
const HANDOFF_VERB = /(מעביר|אעביר|נעביר|יעביר|העביר|להעביר|יחזור אליך|תחזור אליך|יחזרו אליך|נעדכן)/
export function extractEscalationFromText(text: string): string | null {
  if (!REP_WORD.test(text) || !HANDOFF_VERB.test(text)) return null
  return 'הבוט הבטיח ללקוח שנציג יחזור אליו (זוהה מהטקסט, לא מהתגית)'
}

// ─── בניית הודעת שגיאה/אישור ללקוח לפי תוצאת שמירת התור ────────────────────
// (הועבר מ-ai-respond/route.ts כדי לבדוק אוטומטית שהודעת ה"תקלה" הנכונה
// נבחרת לכל סוג כישלון — לא כולם צריכים להישמע כמו "תקלה טכנית")
// נוסח יחיד ואחיד לכל מקרה של "אין באמת רופא/תור זמין" — בין אם זה
// מתגלה בזמן קביעה בפועל (no_doctor_available) או כבר בשלב ההצעה
// החופשית (offer-grounding ב-ai-respond/route.ts). יוסי קבע את הניסוח
// במפורש (24/08) — חייב להיות **אותו משפט בדיוק** בשני המקומות, לא רק
// דומה, כדי שהשיח יישמע עקבי ולא כמו שתי מערכות שונות
export const NO_AVAILABILITY_MESSAGE = 'לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.'

export function buildApptErrorMessage(error: string | undefined, workingHoursText: string): string {
  if (error === 'outside_working_hours') {
    return `השעה שביקשת נמצאת מחוץ לשעות הפעילות שלנו${workingHoursText ? ` (${workingHoursText})` : ''} — אשמח להציע לך שעה אחרת שכן פנויה, מתי עוד נוח לך? 😊`
  }
  if (error === 'business_closed') {
    return 'אנחנו סגורים בתאריך הזה 🙏 אשמח להציע לך תאריך אחר, מתי עוד נוח לך?'
  }
  if (error === 'no_doctor_available') {
    return NO_AVAILABILITY_MESSAGE
  }
  if (error === 'date_in_past') {
    return 'השעה שביקשת כבר עברה 🙏 התכוונת לתאריך אחר, או שנמצא שעה פנויה מאוחר יותר?'
  }
  return 'מצטערים, נתקלנו בתקלה טכנית בעדכון היומן ולא הצלחנו להשלים את הבקשה כרגע 🙏 נציג שלנו יחזור אליך בהקדם לתיאום.'
}

// ─── בניית הודעת אישור מתוקנת כשהתאריך "קפץ" שבוע קדימה אוטומטית ───────────
export function buildRolledForwardMessage(newTimeISO: string, businessAddress?: string | null): string {
  const fmt = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', weekday: 'long',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(new Date(newTimeISO))
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const niceDate = `יום ${get('weekday')} ${get('day')}.${get('month')}.${get('year')} בשעה ${get('hour')}:${get('minute')}`
  return `שמתי לב שהשעה שביקשת כבר עברה השבוע, אז קבעתי לך ל${niceDate} — השבוע הבא באותו יום ושעה 😊${businessAddress ? `\n${businessAddress}` : ''}`
}

// ─── סיכום תור מאומת — תמיד נבנה מהנתונים שנשמרו ואומתו ב-DB (apptResult), ──
// לא מהטקסט שהמודל ניסח. גם אם המודל טעה בתאריך/שכח פרט/כתב "מחר" במקום
// תאריך מפורש — הלקוח עדיין מקבל בסוף כל אישור תור סיכום מדויק וקריא.
export function buildApptConfirmationSummary(params: {
  newTimeISO: string
  doctorName?: string | null
  serviceName?: string | null
  serviceNotes?: string | null
  businessAddress?: string | null
}): string {
  const fmt = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', weekday: 'long',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(new Date(params.newTimeISO))
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const niceDate = `יום ${get('weekday')} ${get('day')}.${get('month')}.${get('year')} בשעה ${get('hour')}:${get('minute')}`

  let line = '✅ קבעתי לך תור'
  if (params.doctorName) line += ` אצל ${params.doctorName}`
  line += ` ל${niceDate}`
  if (params.serviceName) line += `, ${params.serviceName}`
  if (params.serviceNotes) line += ` (${params.serviceNotes})`
  if (params.businessAddress) line += `.\nהכתובת: ${params.businessAddress}`
  return line
}

// תאריך (YYYY-MM-DD) לפי שעון ישראל, לצורך השוואה מדויקת מול תאריכים שהמודל כתב
export function israelDateOnly(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ─── בדיקה: האם הטקסט שהמודל כתב מזכיר תאריך מפורש (DD.MM.YYYY) שלא תואם ────
// לתאריך האמיתי שנשמר? קרה בפועל: המודל כתב "מחר, 10.08.2026" כשהתור בפועל
// (ואומת ב-DB) היה ל-06.08.2026 — הלקוח קיבל הודעה עם שני תאריכים סותרים.
// אם נמצא תאריך שגוי בטקסט, לא סומכים על שום חלק מהניסוח של המודל — הקורא
// (ai-respond) מחליף את ההודעה כולה בסיכום המאומת במקום רק להוסיף אותו בסוף
export function textStatesWrongDate(text: string, correctDateISO: string): boolean {
  const matches = [...text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g)]
  return matches.some(([, d, m, y]) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` !== correctDateISO)
}

// ─── בדיקה: האם הטקסט מזכיר שם רופא/ה שלא תואם למי ששויך בפועל לתור? ────────
// קרה בפועל: שתי קריאות מקבילות לבוט (מרוץ, ראה ai-respond/route.ts) גרמו
// לשני שמות רופאים שונים בשתי הודעות כמעט-כפולות, כשהתור בפועל נשמר בלי
// רופא משויך כלל. אם הטקסט מזכיר שם מתוך allDoctorNames שאינו הרופא הנכון —
// לא סומכים על שום חלק מהניסוח, בדיוק כמו textStatesWrongDate
export function textMentionsWrongDoctor(text: string, correctDoctorName: string | null | undefined, allDoctorNames: string[]): boolean {
  for (const name of allDoctorNames) {
    if (!name) continue
    if (text.includes(name) && name !== correctDoctorName) return true
  }
  return false
}

// ─── רופא/ה שהבוט כבר הזכיר/ה בשם ללקוח בשיחה, לפני שהתור בפועל נשמר ─────────
// קרה בפועל: הבוט אמר "יש לנו תור עם ד"ר גבי סמל" פעמיים בשיחה, אבל שיוך
// הרופא בפועל (רוטציה לפי עומס, כששני רופאים מוסמכים לאותו שירות) בחר
// רופא אחר לגמרי (ד"ר עלא יונס) — האישור הסופי סתר את מה שכבר הובטח ללקוח.
// סורק אחורה (מהאחרונה לראשונה) בהודעות היוצאות של הבוט, ומחזיר את ה-uid
// של האזכור העדכני ביותר — זה מה שהובטח לאחרונה, לא אזכור ישן יותר בשיחה
export function extractMentionedDoctorId(
  messages: { direction: string; content: string }[],
  doctorsById: Record<string, string>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction !== 'outbound') continue
    for (const [uid, name] of Object.entries(doctorsById)) {
      if (name && m.content.includes(name)) return uid
    }
  }
  return null
}

// ─── רופא/ה שהלקוח **עצמו** ביקש בשם — לא שה-LLM הזכיר/בחר מיוזמתו ──────────
// (יוסי, 31/08): ההבחנה הזו קריטית ואסור לנחש אותה מתוך טקסט תשובת ה-AI —
// היא חייבת להתבסס על מי בפועל כתב את השם. נבדל בכוונה מ-extractMentionedDoctorId
// למעלה (סורקת רק הודעות **יוצאות** של הבוט — "מה כבר הובטח") — כאן סורקים
// רק הודעות **נכנסות** מהלקוח. אם הלקוח מעולם לא הזכיר שם רופא בעצמו,
// כל אזכור שם בהצעה הוא יוזמה של המודל, לא בקשה שלו — מותר לתקן אותו
// בשקט בלי להעביר לנציג (ראה השימוש ב-ai-respond/route.ts)
export function extractCustomerRequestedDoctorId(
  messages: { direction: string; content: string }[],
  doctorsById: Record<string, string>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction !== 'inbound') continue
    for (const [uid, name] of Object.entries(doctorsById)) {
      if (name && m.content.includes(name)) return uid
    }
  }
  return null
}

// כינויים נפוצים לאותו טיפול: לקוחות מתארים טיפול במילים יומיומיות
// ("יישור שיניים") שלא בהכרח מכילות מילולית את שם השירות הפורמלי שהעסק
// הגדיר ברשימת השירותים שלו ("אורתודנטיה"). קרה בפועל: אי-ההתאמה גרמה
// לכך שלא שויך רופא לתור בכלל (שיוך רופא תלוי בהתאמת שם שירות מדויקת),
// וכתוצאה מזה גם התור לא סונכרן לאופטימה (חסר קוד רופא)
const SERVICE_SYNONYM_GROUPS: string[][] = [
  ['אורתודנטיה', 'יישור שיניים', 'יישור', 'גשר שקוף'],
  ['השתלות', 'שתלים', 'השתלה', 'שתל'],
  ['הלבנה', 'הלבנת שיניים'],
  ['טיפולים משמרים', 'טיפול שורש', 'סתימה', 'עקירה'],
  // קרה בפועל (יוסי, 19/08): "שיקום הפה" (עם ה' הידיעה, ניסוח יומיומי) לא
  // תאם מילולית ל"שיקום פה מלא" (שם השירות הפורמלי) — אף רופא לא שויך
  ['שיקום פה מלא', 'שיקום הפה', 'שיקום פה'],
  // קרה בפועל (יוסי, 19/08, שנית): המודל כתב ב-APPT.service את תחום
  // ההתמחות של הרופא כפי שהוא עצמו ניסח קודם בשיחה ("כירורגיית פה ולסת"),
  // לא את מה שהלקוח ביקש ("השתלת שיניים") — אף שירות לא תאם, אף רופא לא
  // שויך. תוקן בעיקר במקור (הנחיית הפרומפט חייבת עכשיו העתקה מדויקת משם
  // השירות המוגדר) — זה כאן רק הגנת-על נוספת
  ['השתלות', 'שיקום פה מלא', 'כירורגיית פה ולסת', 'כירורגיה'],
]

function synonymMatch(clean: string, name: string): boolean {
  return SERVICE_SYNONYM_GROUPS.some(group =>
    group.some(a => clean.includes(a)) && group.some(b => name.includes(b))
  )
}

// ─── תיחום סיבת הפנייה לרשימת השירותים המוגדרת בעסק ────────────────────────
// קרה בפועל: הבוט כתב סיבות פנייה חופשיות משיחה חופשית ("ייעוץ", "כאבים"...)
// שלא תמיד תואמות לשירות אמיתי ברשימה, מה שיצר תגיות לא-עקביות במאגר הפונים.
// אם הטקסט תואם שירות מוגדר (הכלה בכל אחד מהכיוונים, או כינוי ידוע) —
// משתמשים בשם השירות המדויק מהרשימה. אם לא נמצאה התאמה ויש בכלל רשימת
// שירותים מוגדרת — "אחר"
export function matchServiceReason(reason: string | null | undefined, services: { name: string }[]): string | null {
  const clean = (reason || '').trim()
  if (!clean || clean === 'null') return null
  if (!services || services.length === 0) return clean

  const found = services.find(sv => {
    const name = (sv.name || '').trim()
    if (!name) return false
    return clean.includes(name) || name.includes(clean) || synonymMatch(clean, name)
  })
  return found ? found.name : 'אחר'
}

// ─── resolver יחיד ל"מהו השירות הפעיל כרגע בשיחה", לפני כל בדיקת זמינות ─────
// (יוסי, 31/08, אחרי מקרה ד"ר גבי סמל): מקור אמת יחיד, בסדר עדיפות ברור —
// לא מנחשים, לא נופלים חזרה ל-lead.treatment_type (הוכח שיכול להיות ישן
// ולא קשור לשיחה הנוכחית, למשל שיחה ארוכה שעברה כמה נושאים).
//
// עדיפות 1: מה שהמודל עצמו כתב בתגית LEAD **בתור הנוכחי**.
// עדיפות 2: ההודעה **הנכנסת** האחרונה של הלקוח עצמו שמזהה שירות אמיתי —
// סורק אחורה כדי לתפוס גם "אני רוצה השתלה" → "יום שני מתאים?" → "כן"
// (בתור האחרון אין את המילה "השתלה" בכלל, אבל השירות עדיין ידוע מהקונטקסט)
//
// אם שתי העדיפויות נכשלות — מחזיר null. הקורא (ai-respond/route.ts) חייב
// להתייחס ל-null כאן כ"לא ידוע בוודאות" ולנקוט fail-closed (לא לשלוח
// הצעת תור לא-מאומתת), לא fail-open כמו שקרה בפועל
export function resolveActiveService(
  inlineReason: string | null | undefined,
  messages: { direction: string; content: string }[],
  services: { name: string }[]
): string | null {
  const fromReason = matchServiceReason(inlineReason, services)
  if (fromReason && fromReason !== 'אחר') return fromReason

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction !== 'inbound') continue
    const fromMessage = matchServiceReason(m.content, services)
    if (fromMessage && fromMessage !== 'אחר') return fromMessage
  }
  return null
}

// ─── זיהוי "מה יש בכלל" (FIND AVAILABLE SLOTS) לעומת בדיקת שעה ספציפית ──────
// (יוסי, 01/09): "מתי פנוי", "מה יש בשלישי", "תרשום לי שעות פנויות" — אלה
// לא בקשה לתאריך/שעה ספציפיים (זה כבר מטופל ע"י extractOfferedDateTime/
// APPT), אלא בקשה לרשימת אפשרויות. אם כבר יש שעה מדויקת (HH:MM) בהודעה,
// זו כנראה בדיקת-שעה רגילה ("10:30 פנוי?"), לא שאלת "מה יש בכלל"
const AVAILABILITY_INQUIRY_PHRASES = ['מתי פנוי', 'מתי יש', 'אילו שעות', 'אילו זמנים', 'איזה שעות', 'מה יש ב', 'שעות פנויות', 'תורים פנויים', 'יש תורים', 'מה פנוי']
const AVAILABILITY_DAY_HINT = /(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|מחר|היום|מחרתיים)/
export function looksLikeAvailabilityInquiry(text: string): boolean {
  if (!text) return false
  if (/\d{1,2}:\d{2}/.test(text)) return false // שעה מדויקת כבר ננקבה — לא "מה יש בכלל"
  if (AVAILABILITY_INQUIRY_PHRASES.some(p => text.includes(p))) return true
  // מקרה נפוץ נוסף: שם יום/מילת-זמן + "פנוי" בלי שעה מדויקת (למשל "ברביעי פנוי?")
  return text.includes('פנוי') && AVAILABILITY_DAY_HINT.test(text)
}

// כל השעות (HH:MM) המוזכרות בטקסט, לפי סדר הופעה — לצורך אימות שהתשובה
// הסופית של הבוט לא מכילה שעה שלא הוחזרה בפועל מ-findAvailableSlots
// (ai-respond/route.ts) — לא מספיק להזריק רשימה לפרומפט, כי ה-LLM עדיין
// עלול "לשפר"/להמציא שעה שלא הייתה בה
export function extractAllTimesInText(text: string): string[] {
  return [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map(([, h, m]) => `${h.padStart(2, '0')}:${m}`)
}

// ─── מיזוג ניתוח ליד (LEAD tag) לתוך שדות עדכון — לוגיקה טהורה, ────────────
// בלי קריאות DB. STATUS_RANK מבטיח שסטטוס תמיד מתקדם קדימה, לא נסוג אחורה
export const STATUS_RANK: Record<string, number> = {
  new: 0, contacted: 1, in_progress: 2, published: 3,
}

// ─── INVARIANT: סטטוס שנבחר ידנית לעולם לא משתנה אוטומטית ──────────────────
// (יוסי, 30/08, אחרי שהבאג הזה הופיע פעמיים בשני נתיבי קוד נפרדים —
// הבוט ומסך היומן): allowlist, לא blacklist. רק הסטטוסים ש"המערכת עצמה
// מנהלת" **לפני** שהליד מגיע ל-published מותרים לשינוי אוטומטי. כל סטטוס
// אחר — כולל published עצמו, וכולל כל סטטוס עתידי שעוד לא קיים היום
// (quote_sent, quote_followup, closed, lost, not_relevant, no_show,
// arrived, וכל דבר שיתווסף בעתיד) — מוגן אוטומטית, בלי שמפתח צריך לזכור
// להוסיף אותו לשום רשימת חסימה.
//
// בכוונה **רשימה מפורשת קבועה, לא נגזרת מ-STATUS_RANK** (יוסי, 30/08):
// גם אם STATUS_RANK ישתנה/יתווסף לו ערך בעתיד, זה לא אמור להשפיע על מי
// שרשאי להשתנות אוטומטית — שתי שאלות נפרדות לגמרי, לא סחף אחת מהשנייה.
// אם published נדרש כ"מקור" למעבר ייעודי (למשל מחיקת תור → in_progress),
// זה מטופל נקודתית באותו flow בלבד (ראה promoteLeadStatusIfAutoManaged
// עם allowedFromStatuses=['published'] ב-appointments/page.tsx), לא כאן
export const AUTO_MANAGED_STATUSES: readonly string[] = ['new', 'contacted', 'in_progress']

// האם מותר למערכת לגעת בסטטוס הזה אוטומטית (כתוצאה מפעילות בוט, טעינת
// עמוד, פתיחת תור, מחיקת תור, Realtime, cron, webhook — כל אירוע טכני
// שאינו בחירה מפורשת של המשתמש)
export function isAutoManagedStatus(status: string | null | undefined): boolean {
  return status == null || AUTO_MANAGED_STATUSES.includes(status)
}

export interface CurrentLead {
  name?: string | null
  status?: string | null
  treatment_type?: string | null
  treatment_type_locked?: boolean
}

export function computeLeadUpdates(current: CurrentLead, analysis: LeadAnalysis): Record<string, string | null> {
  const updates: Record<string, string | null> = {}

  if (analysis.temperature && ['hot', 'medium', 'cold'].includes(analysis.temperature)) {
    updates.temperature = analysis.temperature
  }

  // קרה בפועל: סטטוס "מעקב אחר הצעה" (quote_followup) לא היה ב-STATUS_RANK
  // בכלל — כשחסר, הקוד התייחס אליו כדרגה 0 (כמו "חדש"), אז כל שיחה עם
  // הבוט "קידמה" את הסטטוס בחזרה ודרסה בחירה ידנית. isAutoManagedStatus
  // (allowlist משותף, ראה למעלה) הוא האמת היחידה לזה — לא רק כאן, גם
  // בכל מקום אחר שעלול לשנות סטטוס כתופעת לוואי (appointments/page.tsx)
  const currentStatusIsAutoTracked = isAutoManagedStatus(current.status)
  if (
    currentStatusIsAutoTracked &&
    analysis.status &&
    STATUS_RANK[analysis.status] !== undefined &&
    STATUS_RANK[analysis.status] > (STATUS_RANK[current.status ?? 'new'] ?? 0)
  ) {
    updates.status = analysis.status
  }

  const cleanName = (analysis.name || '').trim()
  if (cleanName && cleanName !== current.name) {
    updates.name = cleanName
    const parts = cleanName.split(/\s+/)
    updates.first_name = parts[0]
    updates.last_name = parts.length > 1 ? parts.slice(1).join(' ') : null
  }

  // אם נציג תיקן ידנית את סיבת הפנייה (treatment_type_locked) — הבוט לא דורס
  // אותה יותר, גם אם הוא "מזהה" סיבה שונה מהשיחה הממשיכה
  const cleanReason = (analysis.reason || '').trim()
  if (!current.treatment_type_locked && cleanReason && cleanReason !== 'null' && cleanReason !== current.treatment_type) {
    updates.treatment_type = cleanReason
  }

  return updates
}
