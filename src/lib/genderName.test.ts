import { describe, it, expect } from 'vitest'
import {
  detectGenderFromMessage, classifyNameGender, extractExplicitFirstName,
  updateGenderNameState, buildGenderInstructionBlock, looksLikeFreshLeadOpener, type ConversationGenderState,
} from './genderName'

const UNKNOWN: ConversationGenderState = {
  gender_state: 'unknown', gender_confidence: null, gender_evidence: null,
  verified_first_name: null, verified_first_name_source: null,
}

describe('detectGenderFromMessage', () => {
  it('returns null when there is no gender cue at all', () => {
    expect(detectGenderFromMessage('היי, רציתי לקבל פרטים')).toBeNull()
  })

  it('detects explicit female self-reference: "אני מחפשת"', () => {
    const r = detectGenderFromMessage('אני מחפשת טיפול בחרדה')
    expect(r?.state).toBe('female')
    expect(r?.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('detects explicit male self-reference: "אני מחפש"', () => {
    const r = detectGenderFromMessage('אני מחפש טיפול')
    expect(r?.state).toBe('male')
    expect(r?.confidence).toBeGreaterThanOrEqual(0.95)
  })

  it('detects "מעוניינת" without the word אני', () => {
    expect(detectGenderFromMessage('מעוניינת לקבל פרטים')?.state).toBe('female')
  })

  it('detects "מעוניין" without the word אני', () => {
    expect(detectGenderFromMessage('מעוניין לקבל מחיר')?.state).toBe('male')
  })

  it('detects "פנויה מחר"', () => {
    expect(detectGenderFromMessage('פנויה מחר בבוקר')?.state).toBe('female')
  })

  it('detects "פנוי מחר"', () => {
    expect(detectGenderFromMessage('פנוי מחר בערב')?.state).toBe('male')
  })

  it('does NOT infer gender from "אשתי מחפשת" — the cue refers to someone else', () => {
    expect(detectGenderFromMessage('אשתי מחפשת טיפול')).toBeNull()
  })

  it('does NOT infer gender from "בעלי מעוניין" — the cue refers to someone else', () => {
    expect(detectGenderFromMessage('בעלי מעוניין לשמוע פרטים')).toBeNull()
  })

  it('does NOT infer gender from "הבן שלי צריך טיפול"', () => {
    expect(detectGenderFromMessage('הבן שלי צריך טיפול')).toBeNull()
  })

  it('does NOT infer gender from "הבת שלי צריכה בדיקה"', () => {
    expect(detectGenderFromMessage('הבת שלי צריכה בדיקה')).toBeNull()
  })

  it('returns null when the message contains both a male and a female cue in the same sentence (ambiguous)', () => {
    expect(detectGenderFromMessage('אני מעוניין או מעוניינת, לא משנה')).toBeNull()
  })

  it('gives higher confidence to an explicit "אני X" phrasing than a bare cue', () => {
    const explicit = detectGenderFromMessage('אני מעוניינת בפרטים')!
    const bare = detectGenderFromMessage('מעוניינת בפרטים')!
    expect(explicit.confidence).toBeGreaterThan(bare.confidence)
  })
})

describe('classifyNameGender', () => {
  it('classifies an unambiguous female name', () => {
    expect(classifyNameGender('שולה')).toBe('female')
  })

  it('classifies an unambiguous male name', () => {
    expect(classifyNameGender('משה')).toBe('male')
  })

  it('classifies a known unisex name as ambiguous, not a guess', () => {
    expect(classifyNameGender('גיל')).toBe('ambiguous')
    expect(classifyNameGender('דניאל')).toBe('ambiguous')
    expect(classifyNameGender('טל')).toBe('ambiguous')
  })

  it('classifies an unrecognized name as ambiguous rather than statistically guessing', () => {
    expect(classifyNameGender('קסניה')).toBe('ambiguous')
  })
})

describe('extractExplicitFirstName', () => {
  it('extracts a name from "קוראים לי X"', () => {
    expect(extractExplicitFirstName('היי, קוראים לי שולה ורציתי לקבל פרטים')).toEqual({ name: 'שולה', source: 'explicit_user_message' })
  })

  it('extracts a name from "אני X" when X is a plausible name, not a known verb/adjective', () => {
    expect(extractExplicitFirstName('אני משה, רציתי לשאול')).toEqual({ name: 'משה', source: 'explicit_user_message' })
  })

  it('does not treat "אני מעוניין" as a name — מעוניין is a recognized gender cue, not a name', () => {
    expect(extractExplicitFirstName('אני מעוניין בפרטים')).toBeNull()
  })

  it('does not treat "אני מחפשת" as a name', () => {
    expect(extractExplicitFirstName('אני מחפשת טיפול')).toBeNull()
  })

  it('returns null when there is no self-introduction at all', () => {
    expect(extractExplicitFirstName('מה המחיר של הטיפול?')).toBeNull()
  })

  it('does not extract a surname-only or business name — there is simply no explicit self-introduction pattern to match', () => {
    // "כהן" or a business name appearing as a WhatsApp display name never even
    // reaches this function — this function only reads the message text itself
    expect(extractExplicitFirstName('כהן ושות׳ בע"מ, אפשר פרטים?')).toBeNull()
  })
})

describe('updateGenderNameState — persistence and contradiction handling across turns', () => {
  it('stays unknown when the message has no cue', () => {
    const { next, changed } = updateGenderNameState(UNKNOWN, 'מה המחיר?')
    expect(next.gender_state).toBe('unknown')
    expect(changed).toBe(false)
  })

  it('moves from unknown to female on an explicit female cue', () => {
    const { next, changed } = updateGenderNameState(UNKNOWN, 'אני מעוניינת בפרטים')
    expect(next.gender_state).toBe('female')
    expect(changed).toBe(true)
  })

  it('does not un-set a locked (explicit, high-confidence) gender on a later ambiguous message', () => {
    const female = updateGenderNameState(UNKNOWN, 'אני מעוניינת בפרטים').next
    const { next } = updateGenderNameState(female, 'מה השעות שלכם?')
    expect(next.gender_state).toBe('female')
  })

  it('a name-based guess (weak) is overridden by a later explicit self-reference (strong)', () => {
    // "משה" alone doesn't appear in these messages — simulate a prior name-based state directly
    const nameBased: ConversationGenderState = {
      gender_state: 'male', gender_confidence: 0.75, gender_evidence: 'שם פרטי: יובל',
      verified_first_name: 'יובל', verified_first_name_source: 'explicit_user_message',
    }
    const { next } = updateGenderNameState(nameBased, 'בעצם אני מעוניינת בפרטים')
    expect(next.gender_state).toBe('female')
  })

  it('persists the verified first name once extracted, and does not overwrite it on a later message', () => {
    const withName = updateGenderNameState(UNKNOWN, 'קוראים לי שולה').next
    expect(withName.verified_first_name).toBe('שולה')
    const { next } = updateGenderNameState(withName, 'אני משה בעצם')
    expect(next.verified_first_name).toBe('שולה') // לא נדרס
  })

  it('infers gender from an unambiguous name when no other cue exists yet', () => {
    const { next } = updateGenderNameState(UNKNOWN, 'קוראים לי שרה ורציתי לקבל פרטים')
    expect(next.gender_state).toBe('female')
    expect(next.verified_first_name).toBe('שרה')
  })

  it('does not infer gender from an ambiguous name like "גיל"', () => {
    const { next } = updateGenderNameState(UNKNOWN, 'קוראים לי גיל')
    expect(next.gender_state).toBe('unknown')
    expect(next.verified_first_name).toBe('גיל')
  })
})

describe('buildGenderInstructionBlock', () => {
  it('produces a neutral instruction (and forbids using any name) when gender and name are both unknown', () => {
    const text = buildGenderInstructionBlock(UNKNOWN)
    expect(text).toContain('אינו ידוע')
    expect(text).toContain('אל תשתמש בשום שם')
  })

  it('produces a female-address instruction, allowing the verified name', () => {
    const text = buildGenderInstructionBlock({ ...UNKNOWN, gender_state: 'female', verified_first_name: 'שולה' })
    expect(text).toContain('נקבה')
    expect(text).toContain('שולה')
  })

  it('produces a male-address instruction', () => {
    const text = buildGenderInstructionBlock({ ...UNKNOWN, gender_state: 'male' })
    expect(text).toContain('זכר')
  })

  // קרה בפועל: מספר טלפון עם שם שמור מלפני שבועות ("צרויה") פתח שיחה
  // חדשה-נראית ("הגעתי דרך המודעה"), והבוט פתח מיד עם השם הישן — למרות
  // שהתברר שזה לא נכון (הלקוח אמר "אני בן" בהמשך). suppressName מונע את זה
  it('suppresses the saved name when suppressName is true, even though a name is verified', () => {
    const text = buildGenderInstructionBlock({ ...UNKNOWN, verified_first_name: 'צרויה' }, true)
    expect(text).not.toContain('צרויה')
    expect(text).toContain('אל תשתמש בשום שם')
  })

  it('still allows the verified name when suppressName is false', () => {
    const text = buildGenderInstructionBlock({ ...UNKNOWN, verified_first_name: 'צרויה' }, false)
    expect(text).toContain('צרויה')
  })
})

describe('looksLikeFreshLeadOpener — detects the canned Facebook/WhatsApp ad-click opening message', () => {
  it('recognizes the real opener seen in production', () => {
    expect(looksLikeFreshLeadOpener('היי, שלום, הגעתי דרך המודעה בפייסבוק ורציתי לקבל פרטים נוספים.')).toBe(true)
  })

  it('does not flag an ordinary mid-conversation message', () => {
    expect(looksLikeFreshLeadOpener('מתי נוח לך להגיע?')).toBe(false)
    expect(looksLikeFreshLeadOpener('כן, בסדר')).toBe(false)
  })

  it('does not flag empty/missing text', () => {
    expect(looksLikeFreshLeadOpener('')).toBe(false)
  })
})
