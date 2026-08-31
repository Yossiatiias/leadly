// ─── זיהוי מגדר ושם פרטי — שכבה דטרמיניסטית, לא תלויה במודל ─────────────────
// המטרה: הבוט לא ינחש מגדר/שם ב"עין" בכל הודעה מחדש. הזיהוי קורה כאן, בקוד,
// לפני שבכלל בונים את הפרומפט למודל — והמודל מקבל הוראה מדויקת לפי המצב
// שכבר נקבע, לא מתבקש "לנחש" בעצמו. ראה buildGenderInstructionBlock.
//
// עקרון מרכזי: ברירת המחדל היא תמיד "לא ידוע". מעדכנים מצב רק על בסיס רמז
// חד-משמעי (הצהרה מפורשת של הפונה על עצמו, או שם פרטי חד-משמעי). לעולם לא
// מנחשים סטטיסטית, ולא דורסים זיהוי חזק (הצהרה מפורשת) בזיהוי חלש יותר.

export type GenderState = 'unknown' | 'male' | 'female'
export type NameGenderClass = 'female' | 'male' | 'ambiguous'

export interface GenderDetection {
  state: 'male' | 'female'
  confidence: number
  evidence: string
}

export interface NameExtraction {
  name: string
  source: 'explicit_user_message'
}

export interface ConversationGenderState {
  gender_state: GenderState
  gender_confidence: number | null
  gender_evidence: string | null
  verified_first_name: string | null
  verified_first_name_source: 'explicit_user_message' | 'verified_metadata' | null
}

// ─── רמזי מגדר מפורשים (פועל/תואר בגוף ראשון) ───────────────────────────────
// כל זוג נבחר כי הוא משתנה לפי מגדר בגוף ראשון — לא כל פועל עושה זאת בעברית
// (למשל "רוצה" זהה לזכר ולנקבה, ולכן לא נכלל)
const FEMALE_CUES = ['מחפשת', 'מעוניינת', 'חדשה', 'יכולה', 'פנויה', 'נשואה', 'צריכה', 'גרה', 'עובדת', 'בטוחה', 'שמחה', 'אמא']
const MALE_CUES   = ['מחפש',  'מעוניין',  'חדש',  'יכול',  'פנוי',  'נשוי',  'צריך',  'גר',  'עובד',  'בטוח',  'שמח',  'אבא']

// ביטויים שמסמנים שהמשפט מדבר על מישהו אחר, לא על הפונה עצמו — "אשתי מחפשת"
// לא אומר שהפונה זכר! חוסמים זיהוי מגדר לגמרי במשפט שבו מופיע אחד מאלה
const THIRD_PARTY_MARKERS = [
  'אשתי', 'בעלי', 'אמא שלי', 'אבא שלי', 'הבן שלי', 'הבת שלי', 'אחי', 'אחותי',
  'חברה שלי', 'חבר שלי', 'בת שלי', 'בן שלי', 'הוא ', ' הוא', 'היא ', ' היא', 'שלו ', 'שלה ',
]

function splitWords(text: string): string[] {
  return text.split(/[\s,.!?;:"'()]+/).filter(Boolean)
}

// סורק את ההודעה משפט-משפט (לא את כולה כמקשה אחת) כדי שרמז שמתייחס לאדם
// אחר בחלק אחד של ההודעה לא "ידביק" חלק אחר שכן מדבר על הפונה עצמו
export function detectGenderFromMessage(text: string): GenderDetection | null {
  if (!text) return null
  const sentences = text.split(/[.!?\n]+/)
  let found: GenderDetection | null = null

  for (const sentence of sentences) {
    if (THIRD_PARTY_MARKERS.some(m => sentence.includes(m))) continue

    const ws = splitWords(sentence)
    const hasFemale = ws.some(w => FEMALE_CUES.includes(w))
    const hasMale = ws.some(w => MALE_CUES.includes(w))
    if (hasFemale && hasMale) continue // סתירה באותו משפט — לא מסיקים כלום ממנו
    if (!hasFemale && !hasMale) continue

    const state: 'male' | 'female' = hasFemale ? 'female' : 'male'
    // "אני מעוניינת" (מפורש) מהימן יותר מ"פנויה מחר" בלי "אני" בתחילת המשפט
    const confidence = ws.includes('אני') ? 0.97 : 0.85
    const evidence = sentence.trim().slice(0, 80)

    if (found && found.state !== state) return null // שני משפטים סותרים באותה הודעה
    if (!found || confidence > found.confidence) found = { state, confidence, evidence }
  }
  return found
}

// ─── מילון שמות — קטן ושמרני בכוונה ──────────────────────────────────────────
// המטרה אינה כיסוי סטטיסטי מלא אלא רק שמות שבישראל הם חד-משמעיים כמעט תמיד.
// כל שם לא ברשימה (כולל שמות דו-מגדריים ידועים כמו גיל/דניאל/טל) מוגדר
// 'ambiguous' — וזו בדיוק ההתנהגות הבטוחה הרצויה, לא חסר-כיסוי.
const CLEARLY_FEMALE_NAMES = new Set([
  'שולה', 'מרים', 'שרה', 'רחל', 'לאה', 'רבקה', 'דנה', 'מיכל', 'נועה', 'יעל',
  'אביגיל', 'חנה', 'אסתר', 'רות', 'תמר', 'שירה', 'אורית', 'ענת', 'מאיה', 'ליטל',
  'טליה', 'נטלי', 'אורלי', 'מירב', 'ורד', 'אילנה', 'יפית', 'הילה', 'קרין',
  'רונית', 'יהודית', 'בתיה', 'פנינה', 'צביה', 'זהבה', 'גלית', 'אורנה', 'ריקי', 'אילנית',
])
const CLEARLY_MALE_NAMES = new Set([
  'משה', 'דוד', 'יוסי', 'יוסף', 'אברהם', 'יצחק', 'יעקב', 'שלמה', 'אריה', 'בנימין',
  'מנחם', 'חיים', 'אליהו', 'יהודה', 'שמעון', 'ראובן', 'לוי', 'אהרון', 'איתמר', 'בועז',
  'גדעון', 'יאיר', 'אסף', 'רועי', 'איתן', 'רפאל', 'גבריאל', 'נתנאל', 'עמוס', 'יונתן',
  'נדב', 'אבישי', 'יגאל', 'זאב', 'רן', 'ארז', 'אילן',
])
// שמות דו-מגדריים ידועים — מפורשים כדי לתעד שהם *במכוון* לא ברשימות למעלה,
// לא רק שכחו להוסיף אותם
const KNOWN_AMBIGUOUS_NAMES = new Set([
  'גיל', 'דניאל', 'טל', 'גל', 'אור', 'שחר', 'יובל', 'עמית', 'רוני', 'נועם',
  'סתיו', 'קרן', 'שרון', 'עדי', 'נגה', 'ליאור', 'הדר', 'אריאל', 'ניצן', 'ירדן', 'שי', 'עידן', 'עומר',
])

export function classifyNameGender(firstName: string): NameGenderClass {
  const name = (firstName || '').trim()
  if (!name) return 'ambiguous'
  if (CLEARLY_FEMALE_NAMES.has(name)) return 'female'
  if (CLEARLY_MALE_NAMES.has(name)) return 'male'
  return 'ambiguous' // כולל KNOWN_AMBIGUOUS_NAMES וכל שם לא-מוכר אחר, במכוון
}

// מילים שאחרי "אני"/"קוראים לי" לא ייחשבו שם — אלה בדיוק רמזי המגדר/כוונה
// שכבר נבדקים בנפרד, לא הצגה עצמית באמצעות שם
const NOT_A_NAME = new Set([
  ...FEMALE_CUES, ...MALE_CUES,
  'רוצה', 'כאן', 'פה', 'שם', 'בסדר', 'מתעניין', 'מתעניינת', 'שואל', 'שואלת', 'פונה',
  'מדבר', 'מדברת', 'זקוק', 'זקוקה', 'מחכה', 'ממתין', 'ממתינה', 'חושב', 'חושבת',
  'יודע', 'יודעת', 'הולך', 'הולכת', 'בא', 'באה',
])

// חילוץ שם פרטי — רק ממקור מפורש בהודעת הלקוח עצמה, לא מהניחוש של המודל
// (שם תצוגה של וואטסאפ/הפענוח של ה-LLM אינם "מקור מאומת" לצורך הזה)
export function extractExplicitFirstName(text: string): NameExtraction | null {
  if (!text) return null

  let m = text.match(/קוראים לי\s+([א-ת]{2,15})/)
  if (m && !NOT_A_NAME.has(m[1])) return { name: m[1], source: 'explicit_user_message' }

  m = text.match(/(?:^|[.!?\n]\s*)אני\s+([א-ת]{2,15})(?=\s|[,.!?]|$)/)
  if (m && !NOT_A_NAME.has(m[1])) return { name: m[1], source: 'explicit_user_message' }

  return null
}

// ─── עדכון מצב השיחה על סמך הודעה חדשה — ליבת ה"שכבה המסודרת" ───────────────
// כלל הדריסה: לעולם לא מורידים ודאות. הצהרה מפורשת ("אני X") ננעלת לצמיתות
// באותה שיחה; רמז חלש (מבוסס שם) תמיד יידחק ע"י כל רמז מבוסס-הודעה, מפורש
// ככל שיהיה, כי הצהרה עצמית עדיפה תמיד על ניחוש משם (ראה יחסי הביטחון למטה)
const LOCK_THRESHOLD = 0.97
const NAME_BASED_CONFIDENCE = 0.75

export function updateGenderNameState(
  current: ConversationGenderState,
  incomingText: string
): { next: ConversationGenderState; changed: boolean } {
  let state = current.gender_state
  let confidence = current.gender_confidence
  let evidence = current.gender_evidence
  let name = current.verified_first_name
  let nameSource = current.verified_first_name_source
  let changed = false

  const det = detectGenderFromMessage(incomingText)
  if (det) {
    const locked = (confidence ?? 0) >= LOCK_THRESHOLD
    if (!locked && det.confidence > (confidence ?? 0)) {
      state = det.state
      confidence = det.confidence
      evidence = det.evidence
      changed = true
    }
  }

  if (!name) {
    const nameExt = extractExplicitFirstName(incomingText)
    if (nameExt) {
      name = nameExt.name
      nameSource = nameExt.source
      changed = true
      if (state === 'unknown') {
        const cls = classifyNameGender(nameExt.name)
        if (cls !== 'ambiguous') {
          state = cls
          confidence = NAME_BASED_CONFIDENCE
          evidence = `שם פרטי: ${nameExt.name}`
        }
      }
    }
  }

  return { next: { gender_state: state, gender_confidence: confidence, gender_evidence: evidence, verified_first_name: name, verified_first_name_source: nameSource }, changed }
}

// ─── זיהוי "פנייה חדשה-נראית" — ביטוי הפתיחה האוטומטי שוואטסאפ/פייסבוק ──────
// שולחים כשמישהו לוחץ על מודעה ("שלח הודעה"). קרה בפועל: מספר טלפון עם שם
// שמור משיחה מלפני שבועות פתח הודעה חדשה עם הביטוי הזה בדיוק, והבוט פתח מיד
// עם השם הישן לפני שהלקוח בכלל הזדהה מחדש — למרות שאין 100% ודאות שהמידע
// הישן עדיין נכון (השם הישן אפילו התברר כלא-נכון באותו מקרה). ההודעה הזו
// היא אות חזק וקבוע ל"זו כנראה פנייה חדשה", בלי תלות בזמן שעבר
const FRESH_LEAD_OPENER_PATTERNS = [
  /הגעתי דרך המודעה/, /ראיתי (את )?המודעה/, /דרך המודעה בפייסבוק/,
  /רציתי לקבל פרטים נוספים/, /ראיתי אתכם בפייסבוק/,
]
export function looksLikeFreshLeadOpener(text: string): boolean {
  return FRESH_LEAD_OPENER_PATTERNS.some(p => p.test(text || ''))
}

// ─── הנחיה דינמית למודל, לפי המצב הסופי — לא "נחש בעצמך" אלא "פעל לפי זה" ────
// suppressName: true מדכא שימוש בשם השמור **בתגובה הזו בלבד** (לא מוחק אותו
// מה-DB) — למקרה של פנייה חדשה-נראית, כדי לא "להניח" זהות בלי ודאות. ראה
// looksLikeFreshLeadOpener למעלה
export function buildGenderInstructionBlock(state: ConversationGenderState, suppressName = false): string {
  const nameRule = (state.verified_first_name && !suppressName)
    ? `מותר להשתמש בשם "${state.verified_first_name}" בפנייה, אך לא חובה בכל הודעה — רק כשזה טבעי.`
    : suppressName
      ? 'זו כנראה פנייה חדשה (הודעת פתיחה טיפוסית) — גם אם יש שם שמור משיחה קודמת, אל תניח שזה אותו מידע. אל תשתמש בשום שם בתגובה הזו. אפשר לשאול בעדינות "איך קוראים לך?" בהמשך הטבעי של השיחה כשמתאים.'
      : 'לא זוהה שם פרטי בוודאות מספקת — אל תשתמש בשום שם כשאתה פונה ללקוח, גם לא שם משפחה.'

  if (state.gender_state === 'female') {
    return `מגדר הפונה: זוהתה בוודאות כנקבה. פנה אליה בלשון נקבה בלבד (למשל "תוכלי", "מעוניינת"). ${nameRule}`
  }
  if (state.gender_state === 'male') {
    return `מגדר הפונה: זוהה בוודאות כזכר. פנה אליו בלשון זכר בלבד (למשל "תוכל", "מעוניין"). ${nameRule}`
  }
  return `מגדר הפונה אינו ידוע. כתוב בעברית טבעית וניטרלית שאינה מסמנת זכר או נקבה. שים לב: גם לשון רבים יכולה להיות ממוגדרת בעברית — הימנע מ"אתם/אתן", "מעוניינים/מעוניינות", "מחפשים/מחפשות". העדף ניסוחים כמו: "איך אפשר לעזור?", "אפשר לספר לי במה מדובר?", "מה תרצו לדעת?", "אשמח לקבל עוד כמה פרטים". ${nameRule}`
}
