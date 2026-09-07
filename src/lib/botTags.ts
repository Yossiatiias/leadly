// ─── פענוח תגיות המבנה שהמודל כותב בסוף כל תשובה ───────────────────────────
// LEAD:{...} / APPT:{...} / REMIND:{...} / GAP:[...] — כל התגיות האלה
// מנותקות מהטקסט שנשלח בפועל ללקוח (הלקוח לעולם לא רואה אותן).
// הלוגיקה כאן הועברה החוצה מ-ai-respond/route.ts כדי שאפשר יהיה לבדוק
// אותה בבדיקות אוטומטיות בלי לקרוא ל-OpenAI/Supabase בפועל.

import { looksLikeSchedulingReply } from './botAppointments'

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
  // (יוסי, 01/09): get('weekday') ב-Intl he-IL כבר כולל את המילה "יום"
  // בעצמה (למשל "יום רביעי") — הוספת "יום " נוספת לפני זה יצרה בפועל
  // "ליום יום רביעי" בהודעת האישור האמיתית. גם פסיקים סביב התאריך, כדי
  // שהמשפט ייקרא בבירור כ"יום, תאריך, שעה" ולא כגוש אחד רציף
  const niceDate = `${get('weekday')}, ${get('day')}.${get('month')}.${get('year')}, בשעה ${get('hour')}:${get('minute')}`

  let line = '✅ קבעתי לך תור'
  if (params.doctorName) line += ` אצל ${params.doctorName}`
  line += ` ל${niceDate}`
  // שם שירות אחד בלבד ללקוח — לא שם פנימי + notes יחד (קרה בפועל: "הלבנה
  // (הלבנת שיניים)", שני שמות לאותו שירות). מעדיפים את הניסוח הידידותי-
  // ללקוח (notes, כשמוגדר) על פני השם הפנימי הקצר; נופלים לשם הפנימי רק
  // כשאין notes בכלל
  const customerFacingService = params.serviceNotes || params.serviceName || null
  if (customerFacingService) line += `, ל${customerFacingService}`
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
// sinceIndex (יוסי, 01/09, FIX 1): מגביל את הסריקה להודעות מהאינדקס הזה
// והלאה בלבד — "העדפת רופא" נשארת קשורה ל-**נושא/שירות הפעיל**, לא לכל
// היסטוריית השיחה. בלי זה, בקשת רופא ישנה מנושא שכבר ננטש (למשל "אשמח
// לד"ר עלא" ואז "בעצם אני רוצה הלבנת שיניים") ממשיכה "לדבוק" ומגבילה
// בטעות חיפוש זמינות לשירות חדש לגמרי שהרופא ההוא בכלל לא מוסמך לו.
// ברירת המחדל (0) שומרת על ההתנהגות הישנה — סריקת כל ההיסטוריה — לקריאות
// שלא מעבירות עוגן (backward compatible)
export function extractCustomerRequestedDoctorId(
  messages: { direction: string; content: string }[],
  doctorsById: Record<string, string>,
  sinceIndex = 0,
): string | null {
  for (let i = messages.length - 1; i >= sinceIndex; i--) {
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
// ─── גרסה עם "עוגן" — מחזירה גם **איפה** השירות הפעיל נקבע ─────────────────
// (יוסי, 01/09, FIX 1): הבסיס לתיקון "doctor preference זולג בין נושאים".
// מקרה אמיתי: הלקוח ביקש ד"ר עלא יונס, עבר לד"ר גבי סמל, ואז עבר לגמרי
// לנושא חדש ("בעצם אני רוצה הלבנת שיניים") — אבל extractCustomerRequestedDoctorId
// המשיכה להחזיר את ההזכרה הישנה של עלא יונס, כי היא סרקה את **כל** ההיסטוריה
// בלי תלות בנושא הפעיל. sinceIndex כאן הוא האינדקס ב-messages שבו השירות
// הפעיל **נקבע** — עדיפות 1 (inlineReason, תור נוכחי): messages.length-1
// (רק ההודעה הנוכחית עצמה נחשבת "באותו רגע"); עדיפות 2 (סריקת היסטוריה):
// האינדקס של ההודעה הנכנסת שבה נמצא השירות. קוראים שרוצים לדעת "מה כבר
// נאמר **מאז שהנושא הזה התחיל**" (כמו preferred-doctor scoping) משתמשים
// ב-sinceIndex הזה כדי לחתוך את הסריקה שלהם, לא לסרוק את כל השיחה
export function resolveActiveServiceAnchor(
  inlineReason: string | null | undefined,
  messages: { direction: string; content: string }[],
  services: { name: string }[]
): { service: string | null; sinceIndex: number } {
  const fromReason = matchServiceReason(inlineReason, services)
  if (fromReason && fromReason !== 'אחר') {
    return { service: fromReason, sinceIndex: Math.max(0, messages.length - 1) }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction !== 'inbound') continue
    const fromMessage = matchServiceReason(m.content, services)
    if (fromMessage && fromMessage !== 'אחר') return { service: fromMessage, sinceIndex: i }
  }
  return { service: null, sinceIndex: 0 }
}

export function resolveActiveService(
  inlineReason: string | null | undefined,
  messages: { direction: string; content: string }[],
  services: { name: string }[]
): string | null {
  return resolveActiveServiceAnchor(inlineReason, messages, services).service
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

// ─── זיהוי הקשרי: הבוט עצמו שאל על תאריך/שעה/זמינות ─────────────────────────
// (יוסי, 01/09, מקרה פרודקשן אמיתי): "מתי אפשר?" לא מזוהה ע"י
// looksLikeAvailabilityInquiry (בלי "פנוי", לא ברשימת הביטויים) — אבל
// כשההודעה **הקודמת של הבוט עצמו** שאלה "יש לך העדפה לתאריך או שעה?",
// כל תגובה של הלקוח (קצרה, עמומה, לא מנוסחת כמו שאלת-זמינות קלאסית)
// היא בבירור המשך לאותה שיחת-תזמון. פותר את זה ברמת ה-ROOT CAUSE — לא
// עוד ביטוי-אחר-ביטוי אצל הלקוח, אלא הקשר מהצד השני של השיחה. אוצר
// המילים כאן קטן ויציב בכוונה: זה הניסוח של הבוט **עצמו** (מוגדר ע"י
// אותו system prompt קבוע), לא אינסוף הניסוחים האפשריים של לקוחות
const BOT_SCHEDULING_MARKERS = ['תאריך', 'שעה', 'מועד', 'מתי נוח', 'העדפה', 'זמינות']
export function botAskedAboutScheduling(text: string): boolean {
  if (!text) return false
  return BOT_SCHEDULING_MARKERS.some(m => text.includes(m))
}

// גם כשהבוט שאל על תאריך/שעה, לא כל תגובה קצרה היא בהכרח המשך של שיחת-
// תזמון — אם התגובה עצמה עוברת בבירור לנושא מידעי אחר (מחיר/מיקום/זהות
// רופא/שעות פעילות), זו סטייה אמיתית מהנושא, לא תשובת-זמינות עמומה
const SCHEDULING_TOPIC_SHIFT_MARKERS = ['עולה', 'מחיר', 'עלות', 'איפה', 'כתובת', 'מיקום', 'מי הרופא', 'מי מבצע', 'שעות פעילות', 'שעות פתיחה']
export function looksLikeSchedulingTopicShift(text: string): boolean {
  if (!text) return false
  return SCHEDULING_TOPIC_SHIFT_MARKERS.some(m => text.includes(m))
}

// ─── שאלת תוכן/מידע — הרחבה ממוקדת של רשימת מעברי-הנושא ─────────────────────
// (ביקורת קוד, root cause): botAskedAboutScheduling+!looksLikeSchedulingTopicShift
// (STAGE 1A) היה רחב מדי — כל תגובה שלא זיהתה במפורש כמעבר-נושא (רשימת
// SCHEDULING_TOPIC_SHIFT_MARKERS: מחיר/כתובת/רופא/שעות פעילות) נחשבה
// "המשך בירור זמינות", כולל שאלות מידע אמיתיות שלא הופיעו ברשימה (למשל
// שאלה על CT). קרה בפועל: "אני מתעניין בהשתלות. האם עושים אצלכם צילום
// CT..." בתגובה לשאלת-תזמון קודמת של הבוט — לא בקשת תור/זמינות בכלל, אך
// נסחפה לתוך הבדיקה ל-forced handoff (strict mode).
//
// התיקון: **לא** מעבר לדרישת-סימן-חיובי (זה נוסה וגרם רגרסיה אמיתית ל-3
// בדיקות STAGE1A קיימות ומאושרות — "מה הכי קרוב?"/"אין לי העדפה"/"תבדוק
// לי" הן תגובות המשך-זמינות עמומות לגיטימיות שאין בהן שום מילת-מפתח
// חיובית, ואסור שיפסיקו להפעיל את הזרימה). במקום זה — **אותה גישה
// בדיוק** כמו SCHEDULING_TOPIC_SHIFT_MARKERS הקיימת, רק מורחבת: עוד שני
// דפוסי-תוכן ספציפיים שלא היו ברשימה: (1) אזכור CT/צילום/רנטגן, (2)
// "יש לכם X?"/"אתם עושים X?" (שאלת "האם קיים שירות", לא בקשת תור) —
// **חוץ מ**מקרה שבו אותה הודעה גם כן נראית כתשובת-תזמון אמיתית (יום/שעה/
// אישור קצר, looksLikeSchedulingReply הקיימת) — כדי לא לפסול בטעות "יש
// לכם תור מחר?" (עדיין בירור זמינות אמיתי, למרות ה"יש לכם")
const CONTENT_QUESTION_MARKERS = ['CT', 'צילום', 'רנטגן']
const OFFERING_INQUIRY_PATTERNS = ['יש לכם', 'אתם עושים', 'אתם מבצעים', 'עושים אצלכם', 'מבצעים אצלכם']
export function looksLikeContentQuestion(text: string): boolean {
  if (!text) return false
  if (CONTENT_QUESTION_MARKERS.some(m => text.includes(m))) return true
  if (looksLikeSchedulingReply(text)) return false // "יש לכם תור מחר?" — עדיין בירור זמינות אמיתי
  return OFFERING_INQUIRY_PATTERNS.some(p => text.includes(p))
}

// כל השעות (HH:MM) המוזכרות בטקסט, לפי סדר הופעה — לצורך אימות שהתשובה
// הסופית של הבוט לא מכילה שעה שלא הוחזרה בפועל מ-findAvailableSlots
// (ai-respond/route.ts) — לא מספיק להזריק רשימה לפרומפט, כי ה-LLM עדיין
// עלול "לשפר"/להמציא שעה שלא הייתה בה
export function extractAllTimesInText(text: string): string[] {
  return [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map(([, h, m]) => `${h.padStart(2, '0')}:${m}`)
}

// כל הזוגות (תאריך DD.MM.YYYY, שעה HH:MM) שמופיעים קרוב זה לזה בטקסט —
// (יוסי, 01/09) לצורך אימות רשימת "התורים הקרובים ביותר" (GENERAL NEXT
// AVAILABLE, כמה תאריכים שונים באותה תשובה) — שם לא מספיק לבדוק שהשעה
// "קיימת איפשהו ברשימה" (extractAllTimesInText, מתאים רק ליום בודד ידוע
// מראש): אותה שעה יכולה להיות אמיתית ביום אחד ומומצאת ביום אחר. דורש
// שהתאריך המלא יופיע ממש ליד השעה (עד 20 תווים ביניהם) — זה בדיוק הפורמט
// שהפרומפט מתבקש להשתמש בו כשיש כמה תאריכים אפשריים (ראה ai-respond/route.ts)
export function extractAllDateTimePairsInText(text: string): { date: string; time: string }[] {
  const pairs: { date: string; time: string }[] = []
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{4})[^\d]{0,20}?(\d{1,2}):(\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    pairs.push({ date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, time: `${m[4].padStart(2, '0')}:${m[5]}` })
  }
  return pairs
}

// ─── SAFE_SLOT_RESPONSE — תשובה דטרמיניסטית, נבנית ישירות מ-slots אמיתיים ────
// (יוסי, 01/09, מקרה פרודקשן אמיתי): service="הלבנה", findNextAvailableSlots
// החזירה 4 slots אמיתיים (01.09 11:00, 01.09 15:00, 02.09 13:00, 02.09 14:00)
// — ובכל זאת הלקוח קיבל "לא מצאתי תור זמין" והועבר לנציג. שורש הבעיה: פעם
// אחת ה-LLM התעלם מהרשימה שהוזרקה לו וענה מעצמו ("אין זמינות"), ופעם שנייה
// ה-post-generation validator כנראה נכשל לפרש את הניסוח שלו ודרס תשובה
// תקינה. INVARIANT עכשיו (route.ts): אם יש slots אמיתיים, שום כשל ניסוח/
// ולידציה של ה-LLM לא יכול להפוך אותם ל"אין זמינות" — כשמתגלה כשל כזה,
// לא חוזרים ל-NO_AVAILABILITY_MESSAGE (זה שמור אך ורק למקרה שבאמת אין
// slots), אלא בונים את התשובה ישירות מהנתונים האמיתיים, בלי LLM בכלל
// (יוסי, 01/09, STAGE 1B): "יום שלישי 11:00" בלבד, בלי תאריך, יוצר עמימות
// אמיתית כשכמה slots חולקים אותו יום-בשבוע בשבועות שונים בתוך טווח
// findNextAvailableSlots (14 יום — הוכח קורה בפועל). כל שורה כוללת עכשיו
// גם תאריך מלא (DD.MM) — לא מסתמכים על כך שה-LLM יכלול אותו בעצמו
// (בדיוק מה שקרה בתקרית האמיתית: קיבל DD.MM.YYYY בפרומפט והשמיט אותו)
const HEB_DAY_NAMES_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// "יום X, DD.MM, בשעה HH:MM" — משותף לכל תשובת-זמינות דטרמיניסטית, כדי
// שכל מקום שמציג slot יציג יום+תאריך+שעה באותו פורמט, לא רק יום+שעה
export function formatDayDateTime(dateISO: string, time: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`)
  const dayName = HEB_DAY_NAMES_FULL[d.getUTCDay()]
  const [, mm, dd] = dateISO.split('-')
  return `יום ${dayName}, ${dd}.${mm}, בשעה ${time}`
}

export function buildSafeSlotResponse(
  slots: { date: string; time: string; doctorId: string }[],
  profileMap: Record<string, string>
): string {
  const lines = slots.map(sl => {
    const doctorName = profileMap[sl.doctorId]
    return `${formatDayDateTime(sl.date, sl.time)}${doctorName ? ` (${doctorName})` : ''}`
  })
  return `יש כרגע כמה אפשרויות:\n\n${lines.join('\n')}\n\nמה הכי מתאים לך? 😊`
}

// ─── SAFE_EXACT_SLOT_RESPONSE — תשובה דטרמיניסטית לבדיקת שעה מדויקת אחת ─────
// (יוסי, 01/09, FIX 2, מקרה פרודקשן אמיתי): "מחר ב-14 יש מצב?" —
// findAvailableDoctorForExactSlot אימתה בפועל status:'available' אצל
// ד"ר מסאוורה, ובכל זאת ה-LLM ענה "לא מצאתי תור זמין". CODE מחליט על
// העובדה (יש/אין, איזה רופא, איזו שעה) — ה-LLM לא רשאי להפוך את זה.
// כשקוד מוודא זמינות אמיתית לשעה מדויקת אחת, התשובה נבנית ישירות מהנתונים
// המאומתים (date/time/doctorId), בלי תלות בניסוח של ה-LLM בכלל
export function buildSafeExactSlotResponse(
  dateISO: string, time: string, doctorName: string | null
): string {
  return `כן 😊 ${formatDayDateTime(dateISO, time)} פנוי${doctorName ? ` אצל ${doctorName}` : ''}. תרצה שאקבע לך?`
}

// ─── חזרה מאוחרת יותר (REMIND) — זיהוי קוד, לא תלוי בציות המודל ─────────────
// (דרישה עסקית): עד כה REMIND היה תלוי לגמרי בכך שהמודל יבחר לכתוב
// את התגית וגם לא ימשיך בירור טיפול/הצעת תור באותה הודעה — שני דברים
// שהם החלטת-ניסוח של המודל, לא עובדה שנאכפת. הזיהוי כאן עצמאי לגמרי:
// route.ts משתמש בו כדי לעצור מראש (לפני קריאה למודל בכלל) את בירור
// הטיפול/הצעת התור, בלי תלות במה שהמודל היה כותב
// (ביקורת קוד): "אפנה מאוחר יותר" הוסר — משמעו שהלקוח/ה עצמו/ה יפנה/תפנה
// אלינו מאוחר יותר, לא בקשה שאנחנו נחזור אליו/ה (בדיוק כמו "אני אחזור
// אליכם" למטה, שגם הוא לא ברשימה הזו מסיבה זהה). "אהיה פנוי/ה מאוחר
// יותר" נשארו בכוונה: אלה נאמרים כתגובה לשאלת הבוט על מועד מועדף (לא
// כפתיחה עצמאית), ולכן במקום הזה בשיחה הם כן מציינים "אז תתקשרו/חזרו
// אליי אז" — סיכון דומה קיים גם ב"נדבר בשבוע הבא"/"נדבר מאוחר יותר"/
// "אני בפגישה" (כולם עלולים תיאורטית להיאמר גם כ"אני אצור קשר בעצמי"),
// אך אלה לא שונו כאן — נשארו כפי שאושרו קודם, לא הוסרו בלי בקשה מפורשת
const LATER_CALLBACK_PHRASES = [
  'תחזור אלי', 'תחזרו אלי', 'תחזרי אלי', 'תחזרו אליי', 'תחזור אליי',
  'דברו איתי בעוד', 'תתקשרו אחר כך', 'תתקשרו אליי', 'תתקשרו אלי', 'תתקשרו לי',
  'אני בפגישה', 'נדבר בשבוע הבא', 'נדבר מאוחר יותר',
  'אהיה פנוי מאוחר יותר', 'אהיה פנויה מאוחר יותר', 'תרשמו לי ליד היומן',
  'ליד היומן', 'ביום אחר נדבר', 'לא נוח לי עכשיו', 'לא פנוי כרגע', 'לא פנויה כרגע',
]
export function looksLikeLaterCallbackRequest(text: string): boolean {
  if (!text) return false
  return LATER_CALLBACK_PHRASES.some(p => text.includes(p))
}

// ─── ביטול בקשת חזרה שכבר ממתינה — לא לבלבל עם "אני אחזור אליכם" ────────────
// (ביקורת קוד): שני מקרים שונים לגמרי חייבים להישאר מובחנים:
// "תחזרו אלי" (הלקוח מבקש שאנחנו נחזור אליו — looksLikeLaterCallbackRequest
// למעלה) מול "אני אחזור אליכם" (הלקוח אומר שהוא/היא ייצור/תיצור קשר בעצמו/ה
// — לא בקשה לחזרה שלנו בכלל, ולא מזוהה ע"י הפונקציה למעלה, ר' הבדיקה).
// הפונקציה הזו רלוונטית רק **כשכבר ממתינים** לתשובת יום/שעה (pending_
// callback_active=true) — מזהה שהלקוח בעצם מוותר על הבקשה המקורית ("לא
// משנה", "עזוב את זה"), כדי לא להמשיך לשאול "איזה יום ושעה" בלי סוף
const CALLBACK_CANCELLATION_PHRASES = [
  'לא משנה', 'עזוב את זה', 'עזבי את זה', 'לא צריך', 'לא צריכה', 'תשכחו מזה',
  'תשכח מזה', 'אני אחזור אליכם', 'אני אתקשר אליכם', 'אני אצור קשר', 'לא נורא',
  'ביטול', 'בטל את זה',
]
export function looksLikeCallbackCancellation(text: string): boolean {
  if (!text) return false
  return CALLBACK_CANCELLATION_PHRASES.some(p => text.includes(p))
}

export function buildCallbackCancelledResponse(): string {
  return 'בסדר גמור 🙏 בכל שלב שנוח לך נשמח לעזור.'
}

// שאלה דטרמיניסטית על מה שעדיין חסר בלבד — לא נוגעת בשום דבר אחר בשיחה.
// (ביקורת קוד): לא מבטיחים "נחזור אליך בהקדם" לפני שבכלל נאסף יום/שעה —
// זו הבטחה שעדיין לא נכונה באותו רגע (עוד אין שום REMIND שמור)
export function buildCallbackAskForTimeResponse(missing: 'date' | 'time' | 'both'): string {
  if (missing === 'both') return 'בשמחה 🙏 באיזה יום ובאיזו שעה יהיה נוח שנחזור אליך?'
  if (missing === 'date') return 'מעולה 😊 באיזה יום יהיה הכי נוח שנחזור אליך?'
  return 'מעולה 😊 באיזו שעה יהיה הכי נוח שנחזור אליך?'
}

export function buildCallbackConfirmedResponse(dateISO: string, time: string): string {
  return `מעולה, נחזור אליך ב${formatDayDateTime(dateISO, time)} 🙏`
}

// ─── מומחה/ה בלי יומן פתוח לקביעה אוטומטית, או שירות בלי שיוך ודאי ──────────
// (דרישה עסקית): תשובה דטרמיניסטית אחת, לא תלויה בניסוח המודל — לעולם
// לא "אין תורים"/"הטיפול לא זמין", רק שהבקשה הועברה לצוות לתיאום. נשלחת
// רק **אחרי** שהאסקלציה עצמה נשמרה בהצלחה ב-DB (ר' route.ts) — אחרת
// buildHandoffUnconfirmedResponse למטה, כדי לא להבטיח ללקוח העברה שלא
// באמת נרשמה
// (דרישה עסקית, שאלת CT): כשמדובר בטיפול רלוונטי-הדמיה (השתלות/שיקום פה
// מלא/אבחון קשור) והשיחה עוד לא מכילה תשובה ברורה — אותה הודעת העברה
// גם שואלת "האם יש לך CT או צילום?", כדי שהצוות יגיע מוכן. שאלה אחת
// בלבד בהודעה, לעולם לא כפילות
export function buildHandoffToRepResponse(includeCtQuestion = false): string {
  const base = 'תודה על הפנייה 🙏 הבקשה הועברה לצוות המרפאה, שיחזור אליך בהקדם לצורך תיאום.'
  if (!includeCtQuestion) return base
  return `${base} כדי שהצוות יוכל להגיע מוכן יותר לשיחה, האם יש לך CT או צילום?`
}

// ─── האם השירות הפעיל רלוונטי-הדמיה (השתלות/שיקום פה מלא/אבחון קשור) ────────
// (דרישה עסקית): רק לטיפולים האלה שואלים על CT/צילום בהעברה לנציג — לא
// להלבנה/שיננית/יישור/ציפויים/טיפולים משמרים רגילים. משתמש באותם כינויים
// מוכרים כבר ב-SERVICE_SYNONYM_GROUPS (לא כפילות-הגדרה — 'שתל'/'שתלים'
// וכו' כבר ידועים כמזהי "השתלות"; כאן זו רשימה נפרדת כי המטרה שונה
// לגמרי — לא "לאיזה שירות מוגדר זה שייך", אלא "האם צילום רלוונטי")
const IMAGING_RELEVANT_SERVICE_MARKERS = ['השתלות', 'שתלים', 'השתלה', 'שתל', 'שיקום פה מלא', 'שיקום הפה', 'שיקום פה', 'אבחון']
export function isImagingRelevantService(service: string | null | undefined): boolean {
  if (!service) return false
  return IMAGING_RELEVANT_SERVICE_MARKERS.some(m => service.includes(m))
}

// ─── האם השיחה כבר מכילה תשובה ברורה על החזקת CT/צילום ──────────────────────
// (דרישה עסקית): לא חוזרים על השאלה אם היא כבר נענתה — בין אם הלקוח אמר
// שיש לו/ה, ובין אם אמר שאין. סורק את כל ההודעות הנכנסות בשיחה (לא רק
// האחרונה) — התשובה יכולה להינתן בכל שלב, לא רק מיד אחרי שהבוט שאל
const CT_POSSESSION_ANSWER_MARKERS = [
  'יש לי CT', 'יש לי צילום', 'יש לי הדמיה', 'יש לי סריקה',
  'אין לי CT', 'אין לי צילום', 'אין לי הדמיה', 'אין לי סריקה',
  'בלי CT', 'בלי צילום', 'לא, אין לי', 'כן, יש לי',
]
export function conversationAlreadyAnsweredImagingQuestion(messages: { direction: string; content: string }[]): boolean {
  return messages.some(m => m.direction === 'inbound' && CT_POSSESSION_ANSWER_MARKERS.some(marker => m.content.includes(marker)))
}

// ─── נפילה כנה כשלא הצלחנו לוודא שהעברה/תזכורת נשמרו בפועל ──────────────────
// (ביקורת קוד): אף פעם לא אומרים ללקוח "הועבר"/"נקבע" בלי שזה אומת ב-DB —
// עדיף ניסוח כללי-אך-אמיתי על פני הבטחה שעלולה להתברר כשקרית
export function buildHandoffUnconfirmedResponse(): string {
  return 'תודה על הפנייה 🙏 אנחנו בודקים את זה ונחזור אליך בהקדם.'
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
