import { describe, it, expect } from 'vitest'
import { parseBotTags, buildApptErrorMessage, buildRolledForwardMessage, buildApptConfirmationSummary, textStatesWrongDate, textMentionsWrongDoctor, israelDateOnly, computeLeadUpdates, matchServiceReason, extractEscalationFromText, extractMentionedDoctorId, extractCustomerRequestedDoctorId, buildSafeSlotResponse, buildSafeExactSlotResponse, botAskedAboutScheduling, looksLikeSchedulingTopicShift, resolveActiveServiceAnchor } from './botTags'

describe('parseBotTags', () => {
  it('parses a full response with all four tags and strips them from the visible text', () => {
    const raw = `קבענו לך תור ל-09.08.2026 בשעה 10:00 😊
LEAD:{"name":"משה כהן","reason":"כאב שן","temperature":"hot","status":"published"}
APPT:{"date":"2026-08-09","time":"10:00","service":"כאב שן"}
REMIND:{"date":"2026-08-10","time":"09:00"}
GAP:[מה המחיר של השתלה?]`
    const parsed = parseBotTags(raw)
    expect(parsed.leadAnalysis).toEqual({ name: 'משה כהן', reason: 'כאב שן', temperature: 'hot', status: 'published' })
    expect(parsed.apptData).toEqual({ date: '2026-08-09', time: '10:00', service: 'כאב שן' })
    expect(parsed.remindData).toEqual({ date: '2026-08-10', time: '09:00' })
    expect(parsed.gapQuestion).toBe('מה המחיר של השתלה?')
    expect(parsed.cleanResponse).toBe('קבענו לך תור ל-09.08.2026 בשעה 10:00 😊')
  })

  it('parses an ESCALATE tag and strips it from the visible text', () => {
    const raw = 'אני מבין, אעביר אותך לנציג שלנו שיחזור אליך בהקדם 🙏\nESCALATE:[הלקוח ביקש רופא שלא קיים אצלנו]'
    const parsed = parseBotTags(raw)
    expect(parsed.escalationReason).toBe('הלקוח ביקש רופא שלא קיים אצלנו')
    expect(parsed.cleanResponse).toBe('אני מבין, אעביר אותך לנציג שלנו שיחזור אליך בהקדם 🙏')
  })

  it('returns nulls for all tags when the response has none', () => {
    const raw = 'שעות הפעילות שלנו הן 9 עד 18'
    const parsed = parseBotTags(raw)
    expect(parsed.leadAnalysis).toBeNull()
    expect(parsed.apptData).toBeNull()
    expect(parsed.remindData).toBeNull()
    expect(parsed.gapQuestion).toBeNull()
    expect(parsed.escalationReason).toBeNull()
    expect(parsed.cleanResponse).toBe(raw)
  })

  it('does not crash on malformed JSON in a tag — treats it as absent', () => {
    const raw = 'תשובה כלשהי\nLEAD:{not valid json}'
    const parsed = parseBotTags(raw)
    expect(parsed.leadAnalysis).toBeNull()
  })

  it('the customer-visible text never contains any raw tag markers', () => {
    const raw = 'טקסט\nLEAD:{"name":null}\nAPPT:{"date":"2026-08-09","time":"10:00"}\nGAP:[שאלה]\nESCALATE:[סיבה]'
    const parsed = parseBotTags(raw)
    expect(parsed.cleanResponse).not.toMatch(/LEAD:|APPT:|REMIND:|GAP:|ESCALATE:/)
  })
})

describe('buildApptErrorMessage', () => {
  it('gives a natural "propose another time" message for outside_working_hours, including the hours', () => {
    const msg = buildApptErrorMessage('outside_working_hours', 'ראשון-חמישי: 09:00-18:00')
    expect(msg).toContain('מחוץ לשעות הפעילות')
    expect(msg).toContain('09:00-18:00')
    expect(msg).not.toContain('תקלה טכנית')
  })

  it('gives a natural "that time has passed" message for date_in_past — not a scary error', () => {
    const msg = buildApptErrorMessage('date_in_past', '')
    expect(msg).toContain('כבר עברה')
    expect(msg).not.toContain('תקלה טכנית')
  })

  it('gives a natural "we are closed" message for business_closed — not a scary error', () => {
    const msg = buildApptErrorMessage('business_closed', '')
    expect(msg).toContain('סגורים')
    expect(msg).not.toContain('תקלה טכנית')
  })

  it('gives a natural "forwarding to a rep" message for no_doctor_available — not a scary error', () => {
    const msg = buildApptErrorMessage('no_doctor_available', '')
    expect(msg).toContain('נציג')
    expect(msg).not.toContain('תקלה טכנית')
  })

  it('falls back to the generic technical-error message for anything else', () => {
    const msg = buildApptErrorMessage('insert_failed', '')
    expect(msg).toContain('תקלה טכנית')
  })
})

describe('buildRolledForwardMessage', () => {
  it('mentions the actual corrected date/time, not a vague statement', () => {
    const msg = buildRolledForwardMessage('2026-08-09T06:00:00.000Z')
    expect(msg).toMatch(/\d{2}\.\d{2}\.\d{4}/) // contains a DD.MM.YYYY date
    expect(msg).toMatch(/\d{2}:\d{2}/) // contains an HH:MM time
  })

  it('appends the business address when provided', () => {
    const msg = buildRolledForwardMessage('2026-08-09T06:00:00.000Z', 'רח׳ הרצל 1, תל אביב')
    expect(msg).toContain('רח׳ הרצל 1, תל אביב')
  })

  it('omits the address line when none is given', () => {
    const msg = buildRolledForwardMessage('2026-08-09T06:00:00.000Z', null)
    expect(msg.split('\n').length).toBe(1)
  })
})

describe('buildApptConfirmationSummary', () => {
  it('always states the exact verified date/time, regardless of what the model said', () => {
    const msg = buildApptConfirmationSummary({ newTimeISO: '2026-08-10T09:00:00.000Z' })
    expect(msg).toMatch(/\d{2}\.\d{2}\.\d{4}/) // DD.MM.YYYY
    expect(msg).toContain('12:00') // 09:00 UTC = 12:00 Israel in August (DST)
  })

  it('includes the doctor name when assigned', () => {
    const msg = buildApptConfirmationSummary({ newTimeISO: '2026-08-10T09:00:00.000Z', doctorName: 'ד"ר אירה' })
    expect(msg).toContain('ד"ר אירה')
  })

  // (יוסי, 01/09): קרה בפועל — "הלבנה (הלבנת שיניים)", שני שמות לאותו
  // שירות. מעדיפים notes (הניסוח הידידותי-ללקוח) על פני השם הפנימי, לא
  // שניהם יחד
  it('shows only the customer-facing service description (notes) when both a name and notes are given, not both', () => {
    const msg = buildApptConfirmationSummary({
      newTimeISO: '2026-08-10T09:00:00.000Z',
      serviceName: 'בדיקת חניכיים',
      serviceNotes: 'כולל צילום פנורמי',
    })
    expect(msg).toContain('כולל צילום פנורמי')
    expect(msg).not.toContain('בדיקת חניכיים')
  })

  it('falls back to the internal service name when no customer-facing notes are configured', () => {
    const msg = buildApptConfirmationSummary({
      newTimeISO: '2026-08-10T09:00:00.000Z',
      serviceName: 'בדיקת חניכיים',
    })
    expect(msg).toContain('בדיקת חניכיים')
  })

  // המקרה האמיתי מפרודקשן: "ליום יום רביעי" (כפילות) + "הלבנה (הלבנת שיניים)"
  it('real production case: no duplicated "יום", no duplicated service name — matches the exact requested output', () => {
    const msg = buildApptConfirmationSummary({
      newTimeISO: '2026-09-02T11:00:00.000Z', // 14:00 Israel, Wednesday
      doctorName: 'ד"ר מסאוורה',
      serviceName: 'הלבנה',
      serviceNotes: 'הלבנת שיניים',
      businessAddress: 'רח\' פתח תקווה 6, בניין החלוצים, נתניה',
    })
    expect(msg).not.toMatch(/יום\s+יום/) // אין "יום יום"
    expect(msg).not.toContain('הלבנה (הלבנת שיניים)') // אין שני שמות לאותו שירות
    expect(msg).toContain('ד"ר מסאוורה')
    expect(msg).toContain('02.09.2026')
    expect(msg).toContain('14:00')
    expect(msg).toContain('להלבנת שיניים')
    expect(msg).toBe('✅ קבעתי לך תור אצל ד"ר מסאוורה ליום רביעי, 02.09.2026, בשעה 14:00, להלבנת שיניים.\nהכתובת: רח\' פתח תקווה 6, בניין החלוצים, נתניה')
  })

  it('includes the business address when provided', () => {
    const msg = buildApptConfirmationSummary({ newTimeISO: '2026-08-10T09:00:00.000Z', businessAddress: 'רח׳ הרצל 1, תל אביב' })
    expect(msg).toContain('רח׳ הרצל 1, תל אביב')
  })

  it('omits optional fields cleanly when none are given', () => {
    const msg = buildApptConfirmationSummary({ newTimeISO: '2026-08-10T09:00:00.000Z' })
    expect(msg).toContain('קבעתי לך תור')
    expect(msg).not.toContain('undefined')
    expect(msg).not.toContain('null')
  })
})

describe('israelDateOnly', () => {
  it('extracts the Israel-local calendar date from a UTC instant', () => {
    // 2026-08-06T07:00:00Z = 10:00 Israel time (summer, +3) on the same day
    expect(israelDateOnly('2026-08-06T07:00:00.000Z')).toBe('2026-08-06')
  })
})

describe('textStatesWrongDate — catches the real bug: model states a date that contradicts the saved appointment', () => {
  it('flags a mismatched DD.MM.YYYY date in the model\'s own confirmation text', () => {
    const modelText = 'רשמתי אותך לפגישת אבחון מחר, ביום ב-10.08.2026 בשעה 10:00.'
    expect(textStatesWrongDate(modelText, '2026-08-06')).toBe(true)
  })

  it('does not flag text whose stated date matches the real appointment', () => {
    const modelText = 'קבעתי לך תור ל-06.08.2026 בשעה 10:00, מחכים לך!'
    expect(textStatesWrongDate(modelText, '2026-08-06')).toBe(false)
  })

  it('does not flag text with no explicit date at all (e.g. "מחר" only)', () => {
    expect(textStatesWrongDate('מחכים לך מחר!', '2026-08-06')).toBe(false)
  })
})

describe('textMentionsWrongDoctor — catches the real bug: two racing bot replies name different doctors', () => {
  const ALL_DOCTORS = ['ד"ר מסאוורה', 'ד"ר אירה', 'ד"ר גבי סמל', 'ד"ר עלא יונס']

  it('flags a mismatched doctor name in the model\'s own confirmation text', () => {
    const modelText = 'קבעתי לך תור אצל ד"ר עלא יונס ליום חמישי בשעה 14:30.'
    expect(textMentionsWrongDoctor(modelText, 'ד"ר אירה', ALL_DOCTORS)).toBe(true)
  })

  it('does not flag text that names the correct doctor', () => {
    const modelText = 'קבעתי לך תור אצל ד"ר אירה ליום חמישי בשעה 14:30.'
    expect(textMentionsWrongDoctor(modelText, 'ד"ר אירה', ALL_DOCTORS)).toBe(false)
  })

  it('does not flag text that names no doctor at all', () => {
    expect(textMentionsWrongDoctor('קבעתי לך תור ליום חמישי בשעה 14:30.', 'ד"ר אירה', ALL_DOCTORS)).toBe(false)
  })

  it('flags a named doctor when no doctor was actually assigned (correctDoctorName is null)', () => {
    const modelText = 'קבעתי לך תור אצל ד"ר עלא יונס ליום חמישי בשעה 14:30.'
    expect(textMentionsWrongDoctor(modelText, null, ALL_DOCTORS)).toBe(true)
  })
})

describe('extractMentionedDoctorId — the doctor the bot already promised the customer by name', () => {
  const DOCTORS = { 'doc-a': 'ד"ר גבי סמל', 'doc-b': 'ד"ר עלא יונס' }

  // קרה בפועל (אלינה מינסקי, 18/08): הבוט אמר "יש לנו תור עם ד"ר גבי סמל"
  // פעמיים בשיחה, אבל שיוך הרופא בפועל (רוטציה בין 2 רופאים מוסמכים) בחר
  // את ד"ר עלא יונס — האישור הסופי סתר את מה שכבר הובטח ללקוח
  it('returns the id of the most recently mentioned doctor in the bot\'s own outbound messages', () => {
    const messages = [
      { direction: 'inbound', content: 'רוצה השתלות' },
      { direction: 'outbound', content: 'יש לנו תורים פנויים עם ד"ר גבי סמל, מומחה להשתלות' },
      { direction: 'inbound', content: 'יום רביעי' },
      { direction: 'outbound', content: 'נרשום אותך לפגישה עם ד"ר גבי סמל' },
      { direction: 'inbound', content: 'אוקי' },
    ]
    expect(extractMentionedDoctorId(messages, DOCTORS)).toBe('doc-a')
  })

  it('returns null when no doctor was mentioned at all', () => {
    const messages = [{ direction: 'outbound', content: 'יש לנו תור פנוי ביום רביעי בשעה 10:00' }]
    expect(extractMentionedDoctorId(messages, DOCTORS)).toBeNull()
  })

  it('ignores a doctor name that only appears in an inbound (customer) message', () => {
    const messages = [{ direction: 'inbound', content: 'אני רוצה את ד"ר גבי סמל' }]
    expect(extractMentionedDoctorId(messages, DOCTORS)).toBeNull()
  })

  it('picks the latest mention when two different doctors were named at different points', () => {
    const messages = [
      { direction: 'outbound', content: 'יש לנו תור עם ד"ר גבי סמל' },
      { direction: 'outbound', content: 'בעצם ד"ר עלא יונס פנוי יותר מוקדם' },
    ]
    expect(extractMentionedDoctorId(messages, DOCTORS)).toBe('doc-b')
  })
})

describe('matchServiceReason — constrains free-text reasons to the business\'s actual service list', () => {
  const SERVICES = [
    { name: 'השתלות' }, { name: 'הלבנה' }, { name: 'אבחון' }, { name: 'אורתודנטיה' },
  ]

  it('returns the exact catalog name when the free text matches a known service', () => {
    expect(matchServiceReason('רוצה לעשות הלבנה', SERVICES)).toBe('הלבנה')
  })

  it('matches when the catalog name is a substring of the free text (and vice versa)', () => {
    expect(matchServiceReason('אבחון', SERVICES)).toBe('אבחון')
  })

  it('falls back to "אחר" when nothing in the free text matches any known service', () => {
    expect(matchServiceReason('כאב ראש', SERVICES)).toBe('אחר')
  })

  it('passes the text through unchanged when the business has no services configured at all', () => {
    expect(matchServiceReason('כאב ראש', [])).toBe('כאב ראש')
  })

  it('returns null for an empty or literal "null" reason', () => {
    expect(matchServiceReason(null, SERVICES)).toBeNull()
    expect(matchServiceReason('null', SERVICES)).toBeNull()
  })

  // קרה בפועל: לקוח כתב "יישור שיניים" (ניסוח יומיומי) כשהשירות המוגדר
  // ברשימת העסק הוא "אורתודנטיה" (מונח פורמלי) — אין הכלה מילולית בין
  // המחרוזות בשום כיוון, אז לפני התיקון זה נפל ל"אחר" ולא שויך רופא לתור
  it('recognizes common colloquial synonyms even without literal substring overlap', () => {
    expect(matchServiceReason('יישור שיניים', SERVICES)).toBe('אורתודנטיה')
    expect(matchServiceReason('רוצה לעשות שתלים', SERVICES)).toBe('השתלות')
  })

  // קרה בפועל (יוסי, 19/08): "שיקום הפה" (עם ה' הידיעה) לא תאם מילולית
  // ל"שיקום פה מלא" (שם השירות הפורמלי) — אף רופא לא שויך לתור בכלל
  it('matches "שיקום הפה" (colloquial, with definite article) to the formal "שיקום פה מלא" service', () => {
    const services = [{ name: 'שיקום פה מלא' }]
    expect(matchServiceReason('שיקום הפה', services)).toBe('שיקום פה מלא')
    expect(matchServiceReason('אני רוצה שיקום הפה', services)).toBe('שיקום פה מלא')
  })

  // קרה בפועל (יוסי, 19/08, שנית): המודל כתב ב-service את תחום ההתמחות
  // של הרופא ("כירורגיית פה ולסת", שהבוט עצמו ניסח קודם בשיחה) במקום את
  // הטיפול שהלקוח ביקש בפועל ("השתלת שיניים") — אף שירות לא תאם
  it('matches "כירורגיית פה ולסת" (a doctor specialty description the model echoed) to a real service, not "אחר"', () => {
    const services = [{ name: 'השתלות' }, { name: 'שיקום פה מלא' }]
    expect(matchServiceReason('כירורגיית פה ולסת', services)).not.toBe('אחר')
  })
})

describe('computeLeadUpdates', () => {
  it('never regresses status backward (published -> new must not happen)', () => {
    const updates = computeLeadUpdates(
      { status: 'published' },
      { status: 'new' }
    )
    expect(updates.status).toBeUndefined()
  })

  it('advances status forward', () => {
    const updates = computeLeadUpdates(
      { status: 'new' },
      { status: 'published' }
    )
    expect(updates.status).toBe('published')
  })

  // קרה בפועל: "מעקב אחר הצעה" (quote_followup) לא היה ב-STATUS_RANK בכלל.
  // כשחסר, הקוד התייחס אליו כדרגה 0 (כמו "חדש") — כל שיחה עם הבוט "קידמה"
  // את הסטטוס בחזרה ל-contacted/in_progress ודרסה את הבחירה הידנית, בכל
  // פעם שהלקוח כתב הודעה חדשה. זה קרה ללקוח אמיתי, לא תרחיש היפותטי
  describe('never overrides a status that is not part of the bot\'s own automatic progression (manually-set, e.g. from a quote flow)', () => {
    // כולל "future_manual_status" — סטטוס בדוי שלא הוגדר באף רשימת חסימה
    // (יוסי, 30/08) — ההוכחה שההגנה היא allowlist ולא blacklist: סטטוס
    // עתידי שיתווסף למערכת מוגן אוטומטית בלי לזכור להוסיף אותו לשום מקום
    const manualStatuses = ['quote_sent', 'quote_followup', 'closed', 'lost', 'not_relevant', 'no_show', 'arrived', 'future_manual_status']
    it.each(manualStatuses)('does not overwrite "%s" even when the bot analyzes a later conversation turn as contacted/in_progress/published', (status) => {
      for (const botStatus of ['contacted', 'in_progress', 'published']) {
        const updates = computeLeadUpdates({ status }, { status: botStatus })
        expect(updates.status).toBeUndefined()
      }
    })
  })

  it('splits a full name into first/last name', () => {
    const updates = computeLeadUpdates({ name: null }, { name: 'משה כהן' })
    expect(updates.first_name).toBe('משה')
    expect(updates.last_name).toBe('כהן')
  })

  it('handles a single-word name with no last name', () => {
    const updates = computeLeadUpdates({ name: null }, { name: 'משה' })
    expect(updates.first_name).toBe('משה')
    expect(updates.last_name).toBeNull()
  })

  it('does not touch the name field if it did not change', () => {
    const updates = computeLeadUpdates({ name: 'משה כהן' }, { name: 'משה כהן' })
    expect(updates.name).toBeUndefined()
  })

  it('ignores a literal "null" string as a reason (model artifact, not a real value)', () => {
    const updates = computeLeadUpdates({ treatment_type: null }, { reason: 'null' })
    expect(updates.treatment_type).toBeUndefined()
  })

  it('rejects an invalid temperature value', () => {
    const updates = computeLeadUpdates({}, { temperature: 'boiling' })
    expect(updates.temperature).toBeUndefined()
  })

  it('does not overwrite treatment_type once it was manually locked by a rep', () => {
    const updates = computeLeadUpdates(
      { treatment_type: 'הלבנת שיניים', treatment_type_locked: true },
      { reason: 'כאב שן' }
    )
    expect(updates.treatment_type).toBeUndefined()
  })

  it('still updates treatment_type from the bot when not locked', () => {
    const updates = computeLeadUpdates(
      { treatment_type: 'הלבנת שיניים', treatment_type_locked: false },
      { reason: 'כאב שן' }
    )
    expect(updates.treatment_type).toBe('כאב שן')
  })
})

describe('extractEscalationFromText — fallback when the model promises a rep but forgets the ESCALATE tag', () => {
  it('catches the exact phrasing seen in production (17/08 real bug)', () => {
    expect(extractEscalationFromText('אעביר אותך לנציג שלנו בהקדם. 😊')).not.toBeNull()
  })
  it('catches "נציג יחזור אליך" phrasing', () => {
    expect(extractEscalationFromText('בסדר גמור, נציג יחזור אליך בהקדם')).not.toBeNull()
  })
  it('returns null for a normal answer with no escalation promise', () => {
    expect(extractEscalationFromText('הטיפול עולה 1500 ש"ח וכולל בדיקה ראשונית')).toBeNull()
  })

  // קרה בפועל (25/08, לימור): הרשימה הישנה של regex-ים מדויקים לא תפסה
  // בדיוק את הניסוח הזה ("אני מעביר את הבקשה" != "אעביר את הפנייה") —
  // לימור קיבלה הבטחה מפורשת בלי שום דגל "ממתין לנציג" בפועל
  it('catches the exact NO_AVAILABILITY_MESSAGE phrasing (real bug: "אני מעביר" / "הבקשה" did not match the old exact-phrase list)', () => {
    expect(extractEscalationFromText('לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם.')).not.toBeNull()
  })

  it('catches an offer-phrased handoff ("אני יכול להעביר...לנציג...שיחזור אליך")', () => {
    expect(extractEscalationFromText('אם תרצה, אני יכול להעביר את הפנייה שלך לנציג שלנו שיחזור אליך בהקדם. האם זה בסדר?')).not.toBeNull()
  })
})

// ─── buildSafeSlotResponse — תשובה דטרמיניסטית בנויה ישירות מ-slots אמיתיים ──
// (יוסי, 01/09, מקרה פרודקשן אמיתי): הבסיס ל-INVARIANT "אם יש slots
// אמיתיים, אף כשל ניסוח/ולידציה לא יכול להפוך אותם ל-'אין זמינות'"
describe('buildSafeSlotResponse — deterministic message built only from real slots, never from the LLM', () => {
  it('builds one line per slot with the correct Hebrew weekday, full DD.MM date, and doctor name', () => {
    const slots = [
      { date: '2026-09-01', time: '11:00', doctorId: 'docA' }, // Tuesday
      { date: '2026-09-02', time: '13:00', doctorId: 'docA' }, // Wednesday
    ]
    const msg = buildSafeSlotResponse(slots, { docA: 'ד"ר מסאוורה' })
    expect(msg).toContain('יום שלישי, 01.09, בשעה 11:00 (ד"ר מסאוורה)')
    expect(msg).toContain('יום רביעי, 02.09, בשעה 13:00 (ד"ר מסאוורה)')
  })

  it('omits the doctor name when it is not found in profileMap, without crashing', () => {
    const msg = buildSafeSlotResponse([{ date: '2026-09-01', time: '11:00', doctorId: 'unknown' }], {})
    expect(msg).toContain('יום שלישי, 01.09, בשעה 11:00')
    expect(msg).not.toContain('()')
  })

  it('never contains any date/time/doctor outside the given slots list', () => {
    const slots = [{ date: '2026-09-01', time: '11:00', doctorId: 'docA' }]
    const msg = buildSafeSlotResponse(slots, { docA: 'ד"ר מסאוורה', docB: 'ד"ר גבי סמל' })
    expect(msg).not.toContain('גבי סמל')
    expect(msg).not.toContain('15:00')
  })

  // (יוסי, 01/09, STAGE 1B): שני "ימי שלישי" בתאריכים שונים — חייבים
  // להיות מובחנים ללקוח, לא רק "יום שלישי" פעמיים
  it('disambiguates two Tuesdays on different dates — the customer sees distinct dates, not just the weekday twice', () => {
    const slots = [
      { date: '2026-09-01', time: '11:00', doctorId: 'docA' }, // שלישי השבוע
      { date: '2026-09-08', time: '11:00', doctorId: 'docA' }, // שלישי שבוע הבא
    ]
    const msg = buildSafeSlotResponse(slots, { docA: 'ד"ר מסאוורה' })
    expect(msg).toContain('יום שלישי, 01.09, בשעה 11:00')
    expect(msg).toContain('יום שלישי, 08.09, בשעה 11:00')
    // שתי השורות שונות זו מזו לגמרי — לא כפילות מבלבלת
    const lines = msg.split('\n').filter(l => l.startsWith('יום'))
    expect(new Set(lines).size).toBe(2)
  })

  // המקרה האמיתי מפרודקשן — 4 slots אמיתיים
  it('real production case: builds a correct message from the exact 4 real slots found', () => {
    const slots = [
      { date: '2026-09-01', time: '11:00', doctorId: 'docMesawarah' },
      { date: '2026-09-01', time: '15:00', doctorId: 'docMesawarah' },
      { date: '2026-09-02', time: '13:00', doctorId: 'docMesawarah' },
      { date: '2026-09-02', time: '14:00', doctorId: 'docMesawarah' },
    ]
    const msg = buildSafeSlotResponse(slots, { docMesawarah: 'ד"ר מסאוורה' })
    expect(msg).toContain('יום שלישי, 01.09, בשעה 11:00 (ד"ר מסאוורה)')
    expect(msg).toContain('יום שלישי, 01.09, בשעה 15:00 (ד"ר מסאוורה)')
    expect(msg).toContain('יום רביעי, 02.09, בשעה 13:00 (ד"ר מסאוורה)')
    expect(msg).toContain('יום רביעי, 02.09, בשעה 14:00 (ד"ר מסאוורה)')
    expect(msg).not.toContain('לא מצאתי תור זמין')
  })
})

// ─── botAskedAboutScheduling / looksLikeSchedulingTopicShift — STAGE 1A ─────
// (יוסי, 01/09, ROOT CAUSE): "מתי אפשר?" לא מזוהה ע"י looksLikeAvailabilityInquiry
// כשלעצמה — אבל בהקשר של הבוט ששאל "יש לך העדפה לתאריך או שעה?" זו
// תשובה חד-משמעית. פותר ברמת ה-context, לא עוד ביטוי אצל הלקוח
describe('botAskedAboutScheduling — small, stable vocabulary of the BOT\'S OWN scheduling language', () => {
  it('recognizes the real production question', () => {
    expect(botAskedAboutScheduling('יש לך העדפה לתאריך או שעה לפגישה עם ד"ר עלא יונס?')).toBe(true)
  })
  it('recognizes other scheduling-preference phrasings the bot might use', () => {
    expect(botAskedAboutScheduling('מתי נוח לך להגיע?')).toBe(true)
    expect(botAskedAboutScheduling('יש לך מועד מועדף?')).toBe(true)
    expect(botAskedAboutScheduling('אני יכול לבדוק את הזמינות הקרובה')).toBe(true)
  })
  it('does not flag an unrelated bot message', () => {
    expect(botAskedAboutScheduling('מחיר העקירה הוא 500 ש"ח')).toBe(false)
    expect(botAskedAboutScheduling('איך קוראים לך?')).toBe(false)
  })
})

describe('looksLikeSchedulingTopicShift — customer reply clearly moves to a different topic', () => {
  it('flags a price question', () => {
    expect(looksLikeSchedulingTopicShift('כמה עולה הטיפול?')).toBe(true)
  })
  it('flags a location question', () => {
    expect(looksLikeSchedulingTopicShift('איפה אתם נמצאים?')).toBe(true)
  })
  it('flags a doctor-identity question', () => {
    expect(looksLikeSchedulingTopicShift('מי הרופא שמטפל בזה?')).toBe(true)
  })
  it('does not flag a vague availability-continuation reply', () => {
    expect(looksLikeSchedulingTopicShift('מתי אפשר?')).toBe(false)
    expect(looksLikeSchedulingTopicShift('אין לי העדפה')).toBe(false)
    expect(looksLikeSchedulingTopicShift('לא משנה לי מתי')).toBe(false)
    expect(looksLikeSchedulingTopicShift('תבדוק לי')).toBe(false)
  })
})

// ─── resolveActiveServiceAnchor + scoped extractCustomerRequestedDoctorId ────
// (יוסי, 01/09, FIX 1, מקרה פרודקשן אמיתי): "אשמח לד"ר עלא" ... "בעצם אני
// רוצה ד"ר גבי" ... "בעצם אני רוצה הלבנת שיניים, מי מבצע?" — הלקוח עבר
// דרך 3 נושאים, ובכל זאת extractCustomerRequestedDoctorId (הלא-מוגבלת)
// המשיכה להחזיר את ההזכרה הראשונה (עלא יונס), שלא רלוונטית יותר, ומגבילה
// בטעות חיפוש זמינות לשירות חדש לגמרי שהוא לא מוסמך לו בכלל
describe('resolveActiveServiceAnchor — same result as resolveActiveService, plus where the active topic was established', () => {
  const services = [{ name: 'השתלות' }, { name: 'הלבנה' }]

  it('priority 2 (history scan): anchor points at the message where the service was found', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה השתלה' },
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'בעצם אני רוצה הלבנת שיניים' },
    ]
    const { service, sinceIndex } = resolveActiveServiceAnchor(null, messages, services)
    expect(service).toBe('הלבנה')
    expect(sinceIndex).toBe(2)
  })

  it('priority 1 (inline reason from current turn): anchor points at the current message only', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה השתלה' },
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'מתי אפשר?' },
    ]
    const { service, sinceIndex } = resolveActiveServiceAnchor('הלבנה', messages, services)
    expect(service).toBe('הלבנה')
    expect(sinceIndex).toBe(2) // messages.length - 1
  })

  it('returns sinceIndex 0 when no service can be resolved at all', () => {
    const messages = [{ direction: 'inbound', content: 'שלום' }]
    const { service, sinceIndex } = resolveActiveServiceAnchor(null, messages, services)
    expect(service).toBeNull()
    expect(sinceIndex).toBe(0)
  })
})

describe('extractCustomerRequestedDoctorId with sinceIndex — doctor preference scoped to the active topic, not the whole conversation', () => {
  const doctorsById = { docA: 'ד"ר עלא יונס', docB: 'ד"ר גבי סמל', docC: 'ד"ר מסאוורה' }

  // 1/10 — התרחיש האמיתי המלא: עלא → גבי → הלבנה, ללא הזכרה חוזרת
  it('1 — real multi-topic case: an old doctor mention from an abandoned topic does not constrain a brand-new service, when scoped to where the new topic started', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה תור עם ד"ר עלא יונס' },
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'בעצם אני רוצה ד"ר גבי סמל' },
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'בעצם אני רוצה תור להלבנת שיניים' }, // <- שירות חדש, sinceIndex=4
      { direction: 'outbound', content: 'הלבנת שיניים מבצע ד"ר מסאוורה. מתי נוח?' },
      { direction: 'inbound', content: 'מתי יש?' },
    ]
    // ללא scoping (ברירת מחדל, sinceIndex=0) — ההתנהגות הישנה, הבעייתית:
    // מחזירה את ההזכרה האחרונה מכל ההיסטוריה (גבי, index 2) — לא רלוונטית
    // יותר לנושא הנוכחי (הלבנה), בדיוק כמו הבאג האמיתי בפרודקשן
    expect(extractCustomerRequestedDoctorId(messages, doctorsById)).toBe('docB')
    // עם scoping לנושא הפעיל (מ-sinceIndex=4, ההודעה שקבעה "הלבנה")
    expect(extractCustomerRequestedDoctorId(messages, doctorsById, 4)).toBeNull() // אין preference פעיל
  })

  // 2 — service switch מנקה preference ישן, גם בלי לשחזר את כל השיחה
  it('2 — a new service introduced in a later message clears the old doctor preference, when scoped from that message', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה תור עם ד"ר גבי סמל להשתלות' },
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'בעצם אני רוצה הלבנת שיניים' }, // שירות חדש, בלי להזכיר את גבי שוב, sinceIndex=2
    ]
    expect(extractCustomerRequestedDoctorId(messages, doctorsById, 2)).toBeNull()
  })

  // 3 — אותו רופא פעיל נשמר כשהלקוח לא עבר נושא
  it('3 — the same active doctor preference is retained across a vague scheduling reply within the same topic', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה ד"ר גבי סמל' }, // sinceIndex=0 (topic never changed)
      { direction: 'outbound', content: 'בטח, מתי נוח?' },
      { direction: 'inbound', content: 'מתי אפשר?' },
    ]
    expect(extractCustomerRequestedDoctorId(messages, doctorsById, 0)).toBe('docB')
  })

  // 4 — בקשה מפורשת ברורה לרופא לא-מוסמך, בנושא הנוכחי, לא נעלמת
  it('4 — an explicit current-topic request for a doctor (even one not qualified for the service) is still captured, not silently dropped', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה הלבנת שיניים אצל ד"ר עלא יונס' }, // sinceIndex=0
    ]
    expect(extractCustomerRequestedDoctorId(messages, doctorsById, 0)).toBe('docA')
  })

  // 5 — אזכור ע"י הבוט בלבד אינו נחשב preference של הלקוח (התנהגות קיימת,
  // לא השתנתה — הפונקציה תמיד סרקה רק inbound; מוודאים שזה נשאר כך)
  it('5 — a doctor named only by the bot is never treated as the customer\'s preference', () => {
    const messages = [
      { direction: 'inbound', content: 'אני רוצה הלבנת שיניים, מי מבצע אצלכם?' },
      { direction: 'outbound', content: 'הלבנת שיניים מבצע ד"ר מסאוורה. מתי נוח?' },
      { direction: 'inbound', content: 'מתי יש?' },
    ]
    expect(extractCustomerRequestedDoctorId(messages, doctorsById, 0)).toBeNull()
  })
})

// ─── buildSafeExactSlotResponse — FIX 2 ─────────────────────────────────────
describe('buildSafeExactSlotResponse — deterministic single-slot response, built only from the verified exact-slot result', () => {
  it('builds a full day+date+time+doctor confirmation', () => {
    const msg = buildSafeExactSlotResponse('2026-09-02', '14:00', 'ד"ר מסאוורה')
    expect(msg).toContain('יום רביעי, 02.09, בשעה 14:00')
    expect(msg).toContain('ד"ר מסאוורה')
    expect(msg).toContain('פנוי')
  })
  it('omits the doctor phrase cleanly when no doctor name is known', () => {
    const msg = buildSafeExactSlotResponse('2026-09-02', '14:00', null)
    expect(msg).toContain('יום רביעי, 02.09, בשעה 14:00')
    expect(msg).not.toContain('אצל ')
  })
})
