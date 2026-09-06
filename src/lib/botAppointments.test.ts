import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normalizeApptDate, israelDateTime, extractApptFromText,
  saveOrRescheduleBotAppointment, type WorkingDay,
  resolveRelativeDayOffset, findRelativeDayOffsetInHistory, israelDateISOOffset,
  looksLikeSchedulingReply, extractOfferedDateTime, hasQualifiedDoctorOnDate, findAvailableDoctorForExactSlot,
  findAvailableSlots, findNextAvailableSlots, israelWeekday, getServiceDoctorAvailabilityStatus,
} from './botAppointments'

describe('normalizeApptDate', () => {
  it('accepts ISO format and pads single digits', () => {
    expect(normalizeApptDate('2026-8-9')).toBe('2026-08-09')
    expect(normalizeApptDate('2026-08-09')).toBe('2026-08-09')
  })
  it('accepts DD.MM.YYYY — day first, not US month-first', () => {
    // 03.08.2026 must mean August 3rd, not March 8th
    expect(normalizeApptDate('03.08.2026')).toBe('2026-08-03')
  })
  it('accepts DD/MM/YYYY', () => {
    expect(normalizeApptDate('9/8/2026')).toBe('2026-08-09')
  })
  it('rejects garbage input', () => {
    expect(normalizeApptDate('not a date')).toBeNull()
    expect(normalizeApptDate('')).toBeNull()
  })
})

describe('israelDateTime', () => {
  it('builds a correct instant for a normal date/time', () => {
    const d = israelDateTime('2026-08-09', '10:00')
    expect(d).not.toBeNull()
  })
  it('rejects a non-existent date (Feb 31) instead of silently rolling into March', () => {
    expect(israelDateTime('2026-02-31', '10:00')).toBeNull()
  })
  it('rejects malformed date/time strings', () => {
    expect(israelDateTime('2026-8-9', '10:00')).toBeNull() // must be zero-padded already
    expect(israelDateTime('2026-08-09', '25:00')).toBeNull()
  })
})

describe('extractApptFromText (fallback when APPT tag is missing)', () => {
  it('extracts date+time from a confirmation message', () => {
    const r = extractApptFromText('קבענו לך תור ל-09.08.2026 בשעה 10:00 😊')
    expect(r).toEqual({ date: '2026-08-09', time: '10:00', service: '' })
  })
  it('takes the LAST date/time mentioned — the new one in a reschedule message', () => {
    const r = extractApptFromText('הזזנו את התור מ-03.08.2026 09:00 ל-10.08.2026 14:00, קבענו לך')
    expect(r?.date).toBe('2026-08-10')
    expect(r?.time).toBe('14:00')
  })
  it('returns null when there is no confirmation language', () => {
    expect(extractApptFromText('מה השעות שלכם?')).toBeNull()
  })
  it('returns null when there is no time in the text', () => {
    expect(extractApptFromText('קבענו לך תור')).toBeNull()
  })
})

describe('resolveRelativeDayOffset', () => {
  it('recognizes "מחר" as +1 day', () => {
    expect(resolveRelativeDayOffset('מחר בערב זה מושלם')).toBe(1)
  })
  it('recognizes "מחרתיים" as +2 days — not confused with "מחר"', () => {
    expect(resolveRelativeDayOffset('אפשר מחרתיים בבוקר?')).toBe(2)
  })
  it('recognizes "בעוד יומיים" as +2 days', () => {
    expect(resolveRelativeDayOffset('בעוד יומיים אני פנוי')).toBe(2)
  })
  it('recognizes "בעוד שלושה ימים" (Hebrew number word) as +3 days', () => {
    expect(resolveRelativeDayOffset('בעוד שלושה ימים בצהריים')).toBe(3)
  })
  it('recognizes "בעוד 4 ימים" (digit) as +4 days', () => {
    expect(resolveRelativeDayOffset('בעוד 4 ימים')).toBe(4)
  })
  it('recognizes "היום" as +0 days', () => {
    expect(resolveRelativeDayOffset('אפשר היום?')).toBe(0)
  })
  it('returns null when no relative-day phrase is present', () => {
    expect(resolveRelativeDayOffset('כמה זה עולה?')).toBeNull()
  })
})

describe('findRelativeDayOffsetInHistory', () => {
  it('finds the most recent relative-day mention scanning backward', () => {
    const history = [
      { content: 'מחפשת הלבנת שיניים' },
      { content: 'מחר בערב זה מושלם' },
      { content: 'אז בצהריים' }, // follow-up that only corrects the time, not the day
    ]
    expect(findRelativeDayOffsetInHistory(history)).toBe(1)
  })
  it('returns null when nothing in the lookback window mentions a relative day', () => {
    expect(findRelativeDayOffsetInHistory([{ content: 'כמה זה עולה?' }])).toBeNull()
  })
})

// קרה בפועל (יוסי, 19/08): הלקוח שאל "למי?" (לא קשור לתאריך בכלל), והמודל
// "נזכר" ובטעות שכפל אישור-תור ישן — ה-fallback הזיז בשקט תור אמיתי
describe('looksLikeSchedulingReply — distinguishes real date/time replies from unrelated questions', () => {
  it('recognizes an explicit date', () => {
    expect(looksLikeSchedulingReply('אפשר ב-26.08.2026?')).toBe(true)
  })
  it('recognizes an explicit time', () => {
    expect(looksLikeSchedulingReply('אפשר ב-14:00?')).toBe(true)
  })
  it('recognizes a day name', () => {
    expect(looksLikeSchedulingReply('רביעי מתאים')).toBe(true)
  })
  it('recognizes a relative-day word', () => {
    expect(looksLikeSchedulingReply('מחר בבוקר')).toBe(true)
  })
  it('recognizes a plain confirmation word', () => {
    expect(looksLikeSchedulingReply('כן')).toBe(true)
    expect(looksLikeSchedulingReply('מתאים לי')).toBe(true)
  })
  it('does NOT treat an unrelated question as a scheduling reply', () => {
    expect(looksLikeSchedulingReply('למי')).toBe(false)
    expect(looksLikeSchedulingReply('כמה זה עולה?')).toBe(false)
    expect(looksLikeSchedulingReply('איפה אתם נמצאים')).toBe(false)
  })
})

// קרה בפועל (24/08, אוריין): הבוט הציע "יש לנו תור פנוי ביום שני הקרוב,
// 30.08.2026, בשעה 10:00" — הרופא היחיד ל"סתימה" לא עובד בימי שני. הלקוח
// קיבל "יש תור" ואז מיד "אין תור" כשביקש לקבוע בפועל
describe('extractOfferedDateTime — extracts a date+time the bot offered, even without confirmation wording', () => {
  it('extracts date and time from a plain offer sentence (no confirm words)', () => {
    const r = extractOfferedDateTime('יש לנו תור פנוי ביום שני הקרוב, 30.08.2026, בשעה 10:00. האם זה מתאים לך?')
    expect(r).toEqual({ date: '2026-08-30', time: '10:00' })
  })
  it('returns null when there is no time in the text', () => {
    expect(extractOfferedDateTime('אנחנו פתוחים בימים א-ה')).toBeNull()
  })
})

describe('hasQualifiedDoctorOnDate — verifies a real doctor is actually available before an offer is sent', () => {
  // דטרמיניסטי, לא תלוי בתאריך שבו הבדיקה רצה — אותה גישה כמו שאר הקובץ
  function nextWeekday(target: number): string {
    const now = new Date()
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
    const offset = ((target - base.getUTCDay() + 7) % 7) || 7
    return new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10)
  }

  const DOC_A = 'doc-a' // עובד רק שלישי/רביעי
  const empResponsibilities = { [DOC_A]: ['טיפולים משמרים'] }
  const employeeSchedules = {
    [DOC_A]: [
      { day: 'ראשון', open: '', close: '', closed: true },
      { day: 'שני', open: '', close: '', closed: true },
      { day: 'שלישי', open: '09:00', close: '16:00', closed: false },
      { day: 'רביעי', open: '09:00', close: '16:00', closed: false },
      { day: 'חמישי', open: '', close: '', closed: true },
    ],
  }

  it('returns false for a date whose weekday the sole qualified doctor does not work (real bug: 30.08.2026 is a Monday)', () => {
    expect(hasQualifiedDoctorOnDate('2026-08-30', 'טיפולים משמרים', empResponsibilities, employeeSchedules)).toBe(false)
  })

  it('returns true for a date the doctor actually works (matching Tuesday)', () => {
    expect(hasQualifiedDoctorOnDate(nextWeekday(2), 'טיפולים משמרים', empResponsibilities, employeeSchedules)).toBe(true)
  })

  it('does not block when the service is unknown/null (not enough information)', () => {
    expect(hasQualifiedDoctorOnDate('2026-08-30', null, empResponsibilities, employeeSchedules)).toBe(true)
  })

  it('does not block when nobody in the business is configured for that service at all (config gap, not an availability issue)', () => {
    expect(hasQualifiedDoctorOnDate('2026-08-30', 'הלבנה', empResponsibilities, employeeSchedules)).toBe(true)
  })

  it('does not block when the business has no doctor-service mapping configured at all', () => {
    expect(hasQualifiedDoctorOnDate('2026-08-30', 'טיפולים משמרים', {}, {})).toBe(true)
  })
})

describe('hasQualifiedDoctorOnDate — employeeMinLeadHours (per-doctor "needs X hours notice")', () => {
  const DOC_A = 'doc-a'
  const empResponsibilities = { [DOC_A]: ['שיקום הפה'] }
  const employeeSchedules = {} // עובד/ת כל יום — רק בודקים את מגבלת השעות מראש

  // מפרק Date להיסט תאריך/שעה בשעון ישראל, כדי לבנות תרחישים דטרמיניסטיים
  // ביחס ל"עכשיו" בזמן הרצת הבדיקה (לא תאריך קבוע בקוד)
  function israelParts(d: Date): { date: string; time: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const get = (t: string) => fmt.find(p => p.type === t)?.value || ''
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` }
  }

  it('blocks a doctor who needs 24h notice when the requested slot is only 2 hours away', () => {
    const { date, time } = israelParts(new Date(Date.now() + 2 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'שיקום הפה', empResponsibilities, employeeSchedules, time, { [DOC_A]: 24 })).toBe(false)
  })

  it('allows the same doctor when the requested slot is 30 hours away', () => {
    const { date, time } = israelParts(new Date(Date.now() + 30 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'שיקום הפה', empResponsibilities, employeeSchedules, time, { [DOC_A]: 24 })).toBe(true)
  })

  it('does not block when no min-lead-hours is configured for the doctor', () => {
    const { date, time } = israelParts(new Date(Date.now() + 1 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'שיקום הפה', empResponsibilities, employeeSchedules, time, {})).toBe(true)
  })

  it('does not block when no time is passed at all (caller did not supply it)', () => {
    const { date } = israelParts(new Date(Date.now() + 1 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'שיקום הפה', empResponsibilities, employeeSchedules, undefined, { [DOC_A]: 24 })).toBe(true)
  })
})

// ─── findAvailableDoctorForExactSlot — בדיקת זמינות אמיתית לפני שליחת הצעה ───
// (יוסי, 31/08): לא רק "עובד/ת ביום הזה" — האם השעה הספציפית שהוצעה
// באמת פנויה, לפי אותה pickAvailableDoctor שמשמשת את הקביעה עצמה
describe('findAvailableDoctorForExactSlot — real time-slot availability before an offer is sent', () => {
  const DOC_A = 'doc-a'
  const DOC_B = 'doc-b'

  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('returns available when the requested time does not overlap the doctor\'s existing appointment', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: israelDateTime(tuesday, '09:00')!.toISOString(), duration_minutes: 60 }],
    })
    const result = await findAvailableDoctorForExactSlot(
      sb, 'biz1', tuesday, '12:00', 60, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, {}
    )
    expect(result.status).toBe('available') // 12:00 לא חופף ל-09:00-10:00
  })

  it('returns unavailable when the requested exact time overlaps the doctor\'s existing appointment', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: israelDateTime(tuesday, '09:00')!.toISOString(), duration_minutes: 60 }],
    })
    const result = await findAvailableDoctorForExactSlot(
      sb, 'biz1', tuesday, '09:00', 60, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, {}
    )
    expect(result.status).toBe('unavailable')
  })

  it('returns the actually-free doctor when doctor A is busy but doctor B qualifies and is free', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: israelDateTime(tuesday, '10:00')!.toISOString(), duration_minutes: 60 }],
    })
    const result = await findAvailableDoctorForExactSlot(
      sb, 'biz1', tuesday, '10:00', 60, 'השתלות',
      { [DOC_A]: ['השתלות'], [DOC_B]: ['השתלות'] }, {}
    )
    expect(result).toEqual({ status: 'available', doctorId: DOC_B })
  })

  it('returns unavailable when no qualified doctor works that day at all', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const result = await findAvailableDoctorForExactSlot(
      sb, 'biz1', tuesday, '10:00', 60, 'הלבנה',
      { [DOC_A]: ['הלבנה'] },
      { [DOC_A]: [{ day: 'שלישי', open: '', close: '', closed: true }] }
    )
    expect(result.status).toBe('unavailable')
  })

  it('returns unknown (does not block) when the service is not recognized', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const result = await findAvailableDoctorForExactSlot(sb, 'biz1', tuesday, '10:00', 60, null, { [DOC_A]: ['הלבנה'] }, {})
    expect(result.status).toBe('unknown')
  })

  it('returns unknown (does not block) when the business has no doctor-service mapping at all', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const result = await findAvailableDoctorForExactSlot(sb, 'biz1', tuesday, '10:00', 60, 'הלבנה', {}, {})
    expect(result.status).toBe('unknown')
  })
})

// ─── findAvailableSlots — FIND AVAILABLE SLOTS, לא רק CHECK EXACT SLOT ──────
// (יוסי, 01/09): לקוח ששאל "תרשום לי מתי פנוי" צריך רשימת שעות אמיתיות,
// לא רק תשובת כן/לא לשעה בודדת. ראה מפרט מלא ב-findAvailableSlots עצמה
describe('findAvailableSlots — real available time slots for a given day (FIND AVAILABLE SLOTS)', () => {
  const DOC_A = 'doc-a'
  const DOC_B = 'doc-b'

  function nextWeekday(target: number): string {
    const now = new Date()
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
    const offset = ((target - base.getUTCDay() + 7) % 7) || 7
    return new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10)
  }

  const narrowSchedule = (day: string) => [{ day, open: '09:00', close: '11:00', closed: false }]

  // A. רופא מוסמך עובד 09:00-11:00 (שני slots של 60 דק'), חלק תפוס
  it('A — returns only the genuinely free slots when part of the day is already booked', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: israelDateTime(tuesday, '09:00')!.toISOString(), duration_minutes: 60 }],
    })
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: narrowSchedule(day) }, {}, 60
    )
    expect(result).toEqual([{ date: tuesday, time: '10:00', doctorId: DOC_A }])
  })

  // B. רופא פנוי אבל לא מוסמך לשירות המבוקש
  it('B — returns no slots for a doctor who is free but not qualified for the requested service', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'השתלות',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: narrowSchedule(day) }, {}, 60
    )
    expect(result).toEqual([])
  })

  // C. רופא מוסמך אבל סגור/ה באותו יום לפי הלוח האישי
  it('C — returns no slots for a doctor who is qualified but closed that day', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: [{ day, open: '', close: '', closed: true }] }, {}, 60
    )
    expect(result).toEqual([])
  })

  // D. שני רופאים מוסמכים — מיזוג אמיתי, בלי כפילות על אותה שעה
  it('D — merges real slots from two qualified doctors without duplicating the same time', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    // DOC_A תפוס ב-09:00, פנוי ב-10:00. DOC_B פנוי בשתיהן — לכן 09:00 חייב
    // להגיע מ-DOC_B (המרכיב האמיתי היחיד הפנוי אז), ו-10:00 מ-DOC_A (הראשון
    // ברשימת qualified שפנוי בפועל) — לא שתי שורות לאותה שעה
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: israelDateTime(tuesday, '09:00')!.toISOString(), duration_minutes: 60 }],
    })
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'], [DOC_B]: ['הלבנה'] },
      { [DOC_A]: narrowSchedule(day), [DOC_B]: narrowSchedule(day) }, {}, 60
    )
    expect(result).toEqual([
      { date: tuesday, time: '09:00', doctorId: DOC_B },
      { date: tuesday, time: '10:00', doctorId: DOC_A },
    ])
  })

  // E. הלקוח ביקש רופא מסוים — לא מציעים תחליף בשקט
  it('E — returns slots only for the doctor the customer explicitly requested, even though another qualified doctor is also free', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'], [DOC_B]: ['הלבנה'] },
      { [DOC_A]: narrowSchedule(day), [DOC_B]: narrowSchedule(day) }, {}, 60,
      DOC_B // preferredDoctorId
    )
    expect(result.every(sl => sl.doctorId === DOC_B)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  // F. employee_min_lead_hours — שעות מוקדמות מדי לא מוחזרות
  // (ביקורת קוד: predeploy ירוק): הבדיקה המקורית חישבה "עכשיו+2 שעות"
  // מול Date.now() אמיתי, בלי לקבע שעון — קרוב לחצות בישראל, closeHour
  // (`Math.min(23, sh+4)`) התכווץ לאותה שעה כמו openHour (חלון 23:00-23:00,
  // בפועל סגור), והבדיקה "unblocked" נכשלה. תוקן ע"י קיבוע שעון ישראל
  // ל-14:00 (אמצע יום, בלי סיכון גלישת חצות) — דטרמיניסטי בכל שעה שהבדיקה
  // רצה בפועל. לא נגעתי בלוגיקת הזמינות עצמה, רק בקיבוע הזמן בבדיקה
  it('F — excludes slots that are too soon for a doctor who requires minimum lead time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-06T10:00:00.000Z')) // שלישי, 12:00 בישראל (חורף, +2)
      // "עכשיו + 2 שעות" = 14:00 בישראל, אותו יום — קרוב מדי מול דרישה
      // של 24 שעות מראש, אבל בבירור בעתיד (לא קרוב לחצות בטעות)
      const soon = { date: '2026-01-06', time: '14:00' }
      const day = israelWeekday(new Date(`${soon.date}T12:00:00Z`))
      const sb = mockSb()

      const blocked = await findAvailableSlots(
        sb, 'biz1', soon.date, 'הלבנה',
        { [DOC_A]: ['הלבנה'] }, { [DOC_A]: [{ day, open: '14:00', close: '18:00', closed: false }] },
        { [DOC_A]: 24 }, 60
      )
      expect(blocked).toEqual([])

      const unblocked = await findAvailableSlots(
        sb, 'biz1', soon.date, 'הלבנה',
        { [DOC_A]: ['הלבנה'] }, { [DOC_A]: [{ day, open: '14:00', close: '18:00', closed: false }] },
        {}, 60
      )
      expect(unblocked.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed (returns no slots) when the service is unknown', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const result = await findAvailableSlots(sb, 'biz1', tuesday, null, { [DOC_A]: ['הלבנה'] }, {}, {}, 60)
    expect(result).toEqual([])
  })

  it('fails closed (returns no slots) when the business has no doctor-service mapping at all', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const result = await findAvailableSlots(sb, 'biz1', tuesday, 'הלבנה', {}, {}, {}, 60)
    expect(result).toEqual([])
  })

  it('respects maxResults, capping at 4 by default even with a long open window', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: [{ day, open: '09:00', close: '17:00', closed: false }] }, {}, 60
    )
    expect(result.length).toBe(4)
  })

  // (יוסי, 01/09, regression #8): המרפאה פתוחה 09:00-17:00, הרופא/ה מוגדר/ת
  // עד 19:00 — findAvailableSlots חייבת לצמצם לחיתוך, לא להשתמש בלוח האישי
  // בלבד. פרמטר businessWorkingHours אופציונלי — לא סופק בכל שאר הבדיקות
  // למעלה, ולכן ההתנהגות הקודמת (רק לוח אישי) לא משתנה כשהוא לא מועבר
  it('caps slots to the intersection of clinic hours and the doctor\'s personal hours — nothing after clinic closing even if the doctor personally works later', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'] },
      { [DOC_A]: [{ day, open: '09:00', close: '19:00', closed: false }] }, // הרופא עובד עד 19:00
      {}, 60, undefined, 10,
      [{ day, open: '09:00', close: '17:00', closed: false }] // אבל המרפאה סגורה מ-17:00
    )
    expect(result.every(sl => sl.time < '17:00')).toBe(true)
    expect(result.some(sl => sl.time === '16:00')).toBe(true) // כן מוצע slot תקין קרוב לסגירה
  })

  it('returns no slots at all when the clinic itself is closed that day, even if the doctor\'s personal schedule shows open', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה',
      { [DOC_A]: ['הלבנה'] },
      { [DOC_A]: [{ day, open: '09:00', close: '17:00', closed: false }] },
      {}, 60, undefined, 4,
      [{ day, open: '', close: '', closed: true }]
    )
    expect(result).toEqual([])
  })

  it('is backward compatible — identical results when businessWorkingHours is omitted', async () => {
    const tuesday = nextWeekday(2)
    const day = israelWeekday(new Date(`${tuesday}T12:00:00Z`))
    const sb = mockSb()
    const withoutParam = await findAvailableSlots(
      sb, 'biz1', tuesday, 'הלבנה', { [DOC_A]: ['הלבנה'] }, { [DOC_A]: narrowSchedule(day) }, {}, 60
    )
    expect(withoutParam.length).toBeGreaterThan(0)
  })
})

// ─── findNextAvailableSlots — GENERAL NEXT AVAILABLE, בלי יום ספציפי ────────
// (יוסי, 01/09): עוטפת findAvailableSlots (ללא שינוי בלוגיקת ה"פנוי באמת"
// שלה) בלולאת סריקה קדימה — ראה מפרט מלא ב-findNextAvailableSlots עצמה
describe('findNextAvailableSlots — scans forward day by day for the first real availability (GENERAL NEXT AVAILABLE)', () => {
  const DOC_A = 'doc-a'
  const DOC_B = 'doc-b'

  function anchorDate(offsetDays = 0): string {
    const now = new Date()
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
    return new Date(base.getTime() + offsetDays * 86400000).toISOString().slice(0, 10)
  }

  // בונה employeeSchedules לרופא שעובד/ת בדיוק ביום השבוע של dateISO,
  // 09:00-11:00 (כמו narrowSchedule למעלה) — שאר הימים לא מוגדרים בכלל,
  // כדי לדמות "היום והיום הבא סגורים, ביום השלישי יש slot" בלי תלות
  // ב"עכשיו" האמיתי בזמן הרצת הבדיקה
  function scheduleForExactDate(dateISO: string): WorkingDay[] {
    const day = israelWeekday(new Date(`${dateISO}T12:00:00Z`))
    return [{ day, open: '09:00', close: '11:00', closed: false }]
  }

  // 2. היום והיום הבא ללא זמינות (הרופא לא מוגדר לעבוד בהם בכלל), ביום
  // השלישי בטווח יש slot — מוחזר, בלי אסקלציה מוקדמת
  it('2 — skips days with no real availability and returns the slot from the first day that actually has one', async () => {
    const day0 = anchorDate(0), day2 = anchorDate(2)
    const sb = mockSb()
    // maxResults=1: מבודד את הבדיקה ל"מה נמצא ראשון כרונולוגית" — בלי זה,
    // אותו שם-יום-בשבוע חוזר גם שבוע אחרי (day2+7) בתוך טווח 14 הימים,
    // וזה נכון ורצוי (regression #3 בודקת בדיוק את זה), רק לא מה שנבדק כאן
    const result = await findNextAvailableSlots(
      sb, 'biz1', day0, 14, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: scheduleForExactDate(day2) }, {}, 60, undefined, 1
    )
    expect(result).toEqual([{ date: day2, time: '09:00', doctorId: DOC_A }])
  })

  // 3. slots בכמה ימים שונים בטווח — רק הראשונים כרונולוגית, עד maxResults.
  // (יוסי, 01/09): חלון 09:00-11:00 קבוע נכשל אם הבדיקה רצה אחה"צ (השעות
  // כבר עברו גם "היום" עצמו, אחרי תיקון meetsMinLeadTime — בצדק). מקפיאים
  // שעון מקומי ל-06:00 בבוקר יום שלישי (2026-01-06, מרוחק מחצות, מאומת) —
  // לא גלובלי לכל הקובץ, רק לבדיקה הזו — כדי שהבדיקה תהיה דטרמיניסטית
  // בבוקר/צהריים/לילה/בעוד שנה, לא רק כשמריצים אותה בבוקר בפועל
  describe('with a frozen local clock (09:00-11:00 must still be in the future)', () => {
    const FROZEN_TUESDAY_MORNING = '2026-01-06T04:00:00.000Z' // = 06:00 שעון ישראל, יום שלישי מאומת
    beforeEach(() => {
      // toFake: ['Date'] בלבד — לא מקפיאים setTimeout/setInterval, כדי לא
      // להשפיע על שום מנגנון תזמון אחר בקוד הנבדק (אין כזה כאן, אבל זו
      // ההרגל הבטוח, ר' route.test.ts שם זה כן קריטי)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(FROZEN_TUESDAY_MORNING))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('3 — returns only the earliest slots chronologically, capped at maxResults, across multiple days that all have availability', async () => {
      const day0 = anchorDate(0)
      // רופא שעובד כל יום 09:00-11:00 (60 דק') — 2 slots/יום, הרבה ימים זמינים
      const anyDaySchedule = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
        .map(day => ({ day, open: '09:00', close: '11:00', closed: false }))
      const sb = mockSb()
      const result = await findNextAvailableSlots(
        sb, 'biz1', day0, 14, 'הלבנה',
        { [DOC_A]: ['הלבנה'] }, { [DOC_A]: anyDaySchedule }, {}, 60, undefined, 3
      )
      expect(result.length).toBe(3)
      const dates = result.map(sl => sl.date)
      expect(dates).toEqual([...dates].sort()) // כרונולוגי
      expect(dates[0]).toBe(day0) // מתחיל מהיום הראשון בטווח שיש בו זמינות
    })
  })

  // 4. אין שום slot בכל הטווח — מערך ריק (מסלול ה-escalation נבדק ב-route.test.ts)
  it('4 — returns an empty array when nothing is available anywhere in the search window', async () => {
    const day0 = anchorDate(0)
    const sb = mockSb()
    const result = await findNextAvailableSlots(
      sb, 'biz1', day0, 14, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, {}, {}, 60 // אין employeeSchedules בכלל לאף יום
    )
    expect(result).toEqual([])
  })

  // 5. הלקוח ביקש רופא מסוים — כל ה-slots שייכים רק לו/ה, גם על פני כמה ימים
  it('5 — restricts results to the explicitly-requested doctor across the whole scanned range', async () => {
    const day0 = anchorDate(0)
    const anyDaySchedule = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
      .map(day => ({ day, open: '09:00', close: '10:00', closed: false }))
    const sb = mockSb()
    const result = await findNextAvailableSlots(
      sb, 'biz1', day0, 14, 'הלבנה',
      { [DOC_A]: ['הלבנה'], [DOC_B]: ['הלבנה'] },
      { [DOC_A]: anyDaySchedule, [DOC_B]: anyDaySchedule }, {}, 60,
      DOC_B
    )
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(sl => sl.doctorId === DOC_B)).toBe(true)
  })

  // 6. השירות לא ידוע — fail-closed, אין סריקה בכלל
  it('6 — fails closed when the service is unknown, without scanning any day', async () => {
    const day0 = anchorDate(0)
    const sb = mockSb()
    const result = await findNextAvailableSlots(sb, 'biz1', day0, 14, null, { [DOC_A]: ['הלבנה'] }, {}, {}, 60)
    expect(result).toEqual([])
  })

  it('stops scanning once maxResults is reached — the loop bound is exact, not "at least"', async () => {
    const day0 = anchorDate(0)
    const anyDaySchedule = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
      .map(day => ({ day, open: '09:00', close: '10:00', closed: false })) // slot אחד/יום
    const sb = mockSb()
    const result = await findNextAvailableSlots(
      sb, 'biz1', day0, 14, 'הלבנה',
      { [DOC_A]: ['הלבנה'] }, { [DOC_A]: anyDaySchedule }, {}, 60, undefined, 2
    )
    expect(result.length).toBe(2)
  })
})

describe('israelDateISOOffset', () => {
  it('adds the given number of days to the base date', () => {
    const base = new Date('2026-08-04T21:57:00.000Z') // faked-as-UTC Israel-local timestamp
    expect(israelDateISOOffset(base, 0)).toBe('2026-08-04')
    expect(israelDateISOOffset(base, 1)).toBe('2026-08-05')
    expect(israelDateISOOffset(base, 6)).toBe('2026-08-10')
  })
})

// ─── Mock Supabase client for saveOrRescheduleBotAppointment tests ──────────
function mockSb(opts: {
  existingAppt?: { id: string; scheduled_at: string } | null
  dayAppts?: { assigned_to: string; scheduled_at: string; duration_minutes: number }[]
  upcomingCounts?: Record<string, number>
} = {}) {
  const state = { lastInsertedISO: '', lastAssignedTo: '', lastUpdatePayload: null as any }

  function build(selectArg: string) {
    const chain: any = {
      _select: selectArg,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (selectArg === 'id, scheduled_at') {
          return { data: opts.existingAppt ?? null }
        }
        if (selectArg.includes('id, scheduled_at, status')) {
          return { data: { id: 'appt-id', scheduled_at: state.lastInsertedISO, status: 'scheduled' } }
        }
        if (selectArg === 'id') {
          return { data: null } // dup check — no dup by default
        }
        return { data: null }
      },
      update: (payload: any) => {
        state.lastUpdatePayload = payload
        state.lastInsertedISO = payload.scheduled_at
        if (payload.assigned_to) state.lastAssignedTo = payload.assigned_to
        return { eq: async () => ({ error: null }) }
      },
      insert: (row: any) => {
        state.lastInsertedISO = row.scheduled_at
        state.lastAssignedTo = row.assigned_to
        return { select: () => ({ single: async () => ({ data: { id: 'appt-id' }, error: null }) }) }
      },
    }
    chain.then = (resolve: any) => {
      if (selectArg.includes('assigned_to, scheduled_at, duration_minutes')) {
        resolve({ data: opts.dayAppts || [] })
      } else if (selectArg === 'assigned_to') {
        const rows: any[] = []
        for (const [uid, count] of Object.entries(opts.upcomingCounts || {})) {
          for (let i = 0; i < count; i++) rows.push({ assigned_to: uid })
        }
        resolve({ data: rows })
      } else {
        resolve({ data: [] })
      }
    }
    return chain
  }

  return {
    state,
    from: (_table: string) => ({
      select: (arg: string) => build(arg),
      insert: (row: any) => build('').insert(row),
    }),
  }
}

const baseParams = {
  businessId: 'biz1',
  leadId: null,
  patientName: 'Test Patient',
  patientPhone: '0500000000',
  service: 'בדיקה',
}

describe('saveOrRescheduleBotAppointment — date validation', () => {
  it('rejects an unparseable date', async () => {
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: 'garbage', time: '10:00' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('unparseable_date')
  })

  it('rejects a date too far in the future (model hallucination)', async () => {
    const farFuture = new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: farFuture, time: '10:00' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('date_too_far')
  })
})

describe('saveOrRescheduleBotAppointment — same-weekday roll-forward', () => {
  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('rolls a past same-day time forward by exactly 7 days instead of failing', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: today, time: '00:05' })
    expect(r.ok).toBe(true)
    expect(r.dateRolledForward).toBe(true)
    const rolled = new Date(r.newTime!)
    const orig = new Date(`${today}T00:05:00+03:00`)
    expect(Math.round((rolled.getTime() - orig.getTime()) / 86400000)).toBe(7)
  })

  it('does not roll forward a genuinely future date', async () => {
    const future = nextWeekday((new Date().getDay() + 2) % 7)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: future, time: '10:00' })
    expect(r.ok).toBe(true)
    expect(r.dateRolledForward).toBeFalsy()
  })
})

describe('saveOrRescheduleBotAppointment — working hours enforcement', () => {
  const workingHours: WorkingDay[] = [
    { day: 'ראשון', open: '09:00', close: '18:00', closed: false },
    { day: 'שני', open: '09:00', close: '18:00', closed: false },
    { day: 'שלישי', open: '09:00', close: '18:00', closed: false },
    { day: 'רביעי', open: '09:00', close: '18:00', closed: false },
    { day: 'חמישי', open: '09:00', close: '18:00', closed: false },
    { day: 'שישי', open: '09:00', close: '13:00', closed: false },
    { day: 'שבת', open: '', close: '', closed: true },
  ]

  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('rejects a booking on a fully-closed day (Saturday)', async () => {
    const saturday = nextWeekday(6)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: saturday, time: '10:00', workingHours })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('outside_working_hours')
  })

  it('rejects a booking after closing time on an open day', async () => {
    const tuesday = nextWeekday(2)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: tuesday, time: '20:00', workingHours })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('outside_working_hours')
  })

  it('accepts a booking within business hours', async () => {
    const tuesday = nextWeekday(2)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: tuesday, time: '10:00', workingHours })
    expect(r.ok).toBe(true)
  })

  it('does not block anything when no working hours are configured (backward compatible)', async () => {
    const saturday = nextWeekday(6)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: saturday, time: '10:00' })
    expect(r.ok).toBe(true)
  })
})

// קרה בפועל: ימי סגירה (חג/חופשה) הגיעו לבוט רק כהקשר בפרומפט ("אל תציע
// תורים בתאריכים האלה"), בלי שום אכיפה בקוד — בדיוק כמו הפער שהיה קודם
// בשעות פעילות. אם המודל בכל זאת אישר תור ביום סגור, הוא נשמר כתקין לגמרי
describe('saveOrRescheduleBotAppointment — business closure exceptions (holidays)', () => {
  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('rejects a booking on a date listed in businessExceptions', async () => {
    const tuesday = nextWeekday(2)
    const r = await saveOrRescheduleBotAppointment(mockSb(), {
      ...baseParams, date: tuesday, time: '10:00',
      businessExceptions: [{ date: tuesday, reason: 'חג' }],
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('business_closed')
  })

  it('accepts a booking on a date not in businessExceptions', async () => {
    const tuesday = nextWeekday(2)
    const wednesday = nextWeekday(3)
    const r = await saveOrRescheduleBotAppointment(mockSb(), {
      ...baseParams, date: tuesday, time: '10:00',
      businessExceptions: [{ date: wednesday, reason: 'חג' }],
    })
    expect(r.ok).toBe(true)
  })

  it('does not block anything when no exceptions are configured (backward compatible)', async () => {
    const tuesday = nextWeekday(2)
    const r = await saveOrRescheduleBotAppointment(mockSb(), { ...baseParams, date: tuesday, time: '10:00' })
    expect(r.ok).toBe(true)
  })
})

describe('saveOrRescheduleBotAppointment — doctor assignment when multiple doctors qualify', () => {
  const DOC_A = 'doc-a'
  const DOC_B = 'doc-b'

  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('picks the doctor who is actually free at the requested time, not always the first one configured', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: `${tuesday}T09:00:00.000Z`, duration_minutes: 60 }],
    })
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'], [DOC_B]: ['השתלות'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })

  it('load-balances between equally-free doctors by fewest upcoming appointments', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({ upcomingCounts: { [DOC_A]: 5, [DOC_B]: 0 } })
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'], [DOC_B]: ['השתלות'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })

  it('assigns directly when only one doctor qualifies — no availability lookup needed', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })

  it('does not assign a doctor who is closed that day on their own personal schedule — picks the one who is actually working', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'אבחון',
      empResponsibilities: { [DOC_A]: ['אבחון'], [DOC_B]: ['אבחון'] },
      employeeSchedules: {
        [DOC_A]: [{ day: 'שלישי', open: '', close: '', closed: true }],
        [DOC_B]: [{ day: 'שלישי', open: '09:00', close: '18:00', closed: false }],
      },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })

  // קרה בפועל (יוסי, 19/08): רופא שסגר את כל ימי העבודה שלו קיבל תור בכל
  // זאת, כי כשאף אחד לא היה "זמין היום" הקוד היה חוזר לרשימה המלאה. יוסי
  // קבע במפורש: "בוט קובע לפי זמינות אמיתית ביומן בלבד" — התנהגות הפוכה
  // מהמקורית (שם הטסט שונה בהתאם, זו לא עוד "נופל בחזרה" אלא "דוחה")
  it('rejects the booking when every qualified doctor is closed that day, instead of assigning one anyway', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
      employeeSchedules: { [DOC_A]: [{ day: 'שלישי', open: '', close: '', closed: true }] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  it('rejects the booking when the sole qualified doctor is already booked at that exact time', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: `${tuesday}T09:00:00.000Z`, duration_minutes: 60 }],
    })
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  // מפרק Date להיסט תאריך/שעה בשעון ישראל, כדי לבנות תרחישים דטרמיניסטיים
  // ביחס ל"עכשיו" בזמן הרצת הבדיקה
  function israelParts(d: Date): { date: string; time: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const get = (t: string) => fmt.find(p => p.type === t)?.value || ''
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` }
  }

  it('rejects a booking with a doctor who requires 24h notice when the requested slot is only 2 hours away', async () => {
    const { date, time } = israelParts(new Date(Date.now() + 2 * 3600000))
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date, time, service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
      employeeMinLeadHours: { [DOC_A]: 24 },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  it('books normally with the same doctor when the requested slot is far enough ahead (30h > 24h required)', async () => {
    const { date, time } = israelParts(new Date(Date.now() + 30 * 3600000))
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date, time, service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
      employeeMinLeadHours: { [DOC_A]: 24 },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })

  it('does not treat "nobody configured for this service at all" as no_doctor_available (unaffected, existing behavior)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'לא-קיים',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
    })
    expect(r.ok).toBe(true)
    expect(r.assignedTo).toBeNull()
  })

  it('only honors preferredDoctorId when they are actually free at that exact time, otherwise falls through to another qualified doctor', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({
      dayAppts: [{ assigned_to: DOC_A, scheduled_at: `${tuesday}T09:00:00.000Z`, duration_minutes: 60 }],
    })
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'], [DOC_B]: ['הלבנה'] },
      preferredDoctorId: DOC_A,
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })

  it('ignores employeeSchedules entirely when not provided (backward compatible)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })

  // קרה בפועל (אלינה מינסקי, 18/08): הבוט הזכיר "ד"ר גבי סמל" ללקוח בשיחה,
  // אבל הרוטציה בין שני רופאים מוסמכים לאותו שירות שייכה בפועל את ד"ר עלא
  // יונס — האישור הסופי סתר את מה שכבר נאמר. preferredDoctorId מכבד את מי
  // שכבר הובטח, במקום להריץ רוטציה עצמאית שלא מודעת לכך
  it('honors preferredDoctorId over load-balancing when the promised doctor still qualifies', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({ upcomingCounts: { [DOC_A]: 5, [DOC_B]: 0 } }) // DOC_B היה נבחר ברוטציה רגילה (פחות עמוס)
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'], [DOC_B]: ['השתלות'] },
      preferredDoctorId: DOC_A,
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })

  it('falls back to normal load-balancing when preferredDoctorId is not actually qualified', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb({ upcomingCounts: { [DOC_A]: 5, [DOC_B]: 0 } })
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'], [DOC_B]: ['השתלות'] },
      preferredDoctorId: 'doc-not-qualified',
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })
})

describe('saveOrRescheduleBotAppointment — secondaryService narrows to the doctor actually qualified for the real treatment', () => {
  const DOC_A = 'doc-a' // עושה אבחונים כלליים אבל לא שתלים
  const DOC_B = 'doc-b' // עושה גם אבחונים וגם שתלים

  // דטרמיניסטי, לא תלוי בתאריך/שעה/timezone שבו הבדיקה רצה (יוסי, 01/09):
  // הגרסה הקודמת חישבה עם d.getDay() (יום מקומי) ואז חתכה עם toISOString()
  // (UTC) — כשהזמן המקומי היה 00:00-02:59 בישראל בקיץ, ה-UTC עדיין "אתמול",
  // ותאריך "יום שלישי" יצא בפועל יום שני. כאן: כל החישוב ב-UTC לאורך כל
  // הדרך, מעוגן בצהריים (לא חצות) — getUTCDay של תאריך שנבנה כך תמיד משקף
  // את יום השבוע האמיתי של אותו Y-M-D (עובדה קלנדרית, לא תלוית timezone),
  // ואין חיתוך יום שגוי כי גם הבנייה וגם הפלט הסופי רחוקים מגבול חצות.
  // baseISO אופציונלי מאפשר תאריך התייחסות קבוע לבדיקה ישירה של ההתנהגות.
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

  it('excludes a doctor who does not perform the lead\'s actual (more specific) treatment', async () => {
    // קרה בפועל: APPT.service="אבחון" (כללי) תואם לשני הרופאים, אבל הליד
    // עצמו הוא בקשה ל"השתלות" — רק DOC_B מוסמך לזה. בלי secondaryService,
    // כל רופא "אבחון" יכול היה להישלח, כולל מי שלא עושה שתלים בכלל
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'אבחון', secondaryService: 'השתלות',
      empResponsibilities: { [DOC_A]: ['אבחון'], [DOC_B]: ['אבחון', 'השתלות'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_B)
  })

  it('falls back to the general-service qualified list when nobody matches the secondary service (fails open, does not refuse the booking)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'אבחון', secondaryService: 'אורתודנטיה',
      empResponsibilities: { [DOC_A]: ['אבחון'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })

  it('ignores secondaryService when it is the same as the primary service or "אחר"', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה', secondaryService: 'אחר',
      empResponsibilities: { [DOC_A]: ['הלבנה'] },
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })
})

// ─── meetsMinLeadTime — no slot in the past, ever ────────────────────────────
// (יוסי, 01/09, מקרה פרודקשן אמיתי): 11:00 חזר כ-"פנוי" כשהשעה האמיתית
// כבר הייתה 12:09, כי minHours=0/undefined גרם ל-meetsMinLeadTime להחזיר
// true בלי לבדוק שה-slot בכלל בעתיד. כלל עסקי: בלי min-lead — slot > now;
// עם min-lead — slot >= now+minHours. לעולם לא slot בעבר
describe('meetsMinLeadTime — no minLeadHours: falls back to "slot must simply be in the future" (via hasQualifiedDoctorOnDate)', () => {
  const DOC_A = 'doc-a'
  const empResponsibilities = { [DOC_A]: ['בדיקה'] }
  const employeeSchedules = {} // עובד/ת כל יום — בודקים רק את חוק "לא בעבר"

  function israelParts(d: Date): { date: string; time: string } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const get = (t: string) => fmt.find(p => p.type === t)?.value || ''
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` }
  }

  // 1. אין minLeadHours + slot שכבר עבר → BLOCKED
  it('1 — no minLeadHours configured, slot already 30 minutes in the past: BLOCKED', () => {
    const { date, time } = israelParts(new Date(Date.now() - 30 * 60000))
    expect(hasQualifiedDoctorOnDate(date, 'בדיקה', empResponsibilities, employeeSchedules, time, {})).toBe(false)
  })

  // 2. אין minLeadHours + slot עתידי → ALLOWED
  it('2 — no minLeadHours configured, slot 30 minutes in the future: ALLOWED', () => {
    const { date, time } = israelParts(new Date(Date.now() + 30 * 60000))
    expect(hasQualifiedDoctorOnDate(date, 'בדיקה', empResponsibilities, employeeSchedules, time, {})).toBe(true)
  })

  // 3. minLeadHours=2 + slot בעוד שעה → BLOCKED
  it('3 — minLeadHours=2, slot only 1 hour away: BLOCKED', () => {
    const { date, time } = israelParts(new Date(Date.now() + 1 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'בדיקה', empResponsibilities, employeeSchedules, time, { [DOC_A]: 2 })).toBe(false)
  })

  // 4. minLeadHours=2 + slot בעוד 3 שעות → ALLOWED
  it('4 — minLeadHours=2, slot 3 hours away: ALLOWED', () => {
    const { date, time } = israelParts(new Date(Date.now() + 3 * 3600000))
    expect(hasQualifiedDoctorOnDate(date, 'בדיקה', empResponsibilities, employeeSchedules, time, { [DOC_A]: 2 })).toBe(true)
  })
})

describe('meetsMinLeadTime propagation — no past slot survives through any of the four public entry points', () => {
  const DOC_A = 'doc-a'
  // שחזור מדויק של המקרה האמיתי: שלישי, 10:00-16:00, "עכשיו" קפוא ל-12:09 —
  // 11:00 חייב להיחסם, 13:00+ חייב לעבור. Date בלבד מוקפא (לא setTimeout)
  const FROZEN_TUESDAY_NOON = '2026-01-06T10:09:00.000Z' // = 12:09 שעון ישראל, יום שלישי מאומת
  const schedule = { [DOC_A]: [{ day: 'שלישי', open: '10:00', close: '16:00', closed: false }] }
  const responsibilities = { [DOC_A]: ['הלבנה'] }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FROZEN_TUESDAY_NOON))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 5. findAvailableSlots לא מחזירה שעות שכבר עברו היום
  it('5 — findAvailableSlots does not return hours that have already passed today', async () => {
    const today = new Date().toISOString().slice(0, 10) // 2026-01-06, בזמן הקפוא
    const sb = mockSb()
    const result = await findAvailableSlots(
      sb, 'biz1', today, 'הלבנה', responsibilities, schedule, {}, 60, undefined, 10
    )
    expect(result.some(sl => sl.time === '10:00')).toBe(false)
    expect(result.some(sl => sl.time === '11:00')).toBe(false) // בדיוק המקרה האמיתי
    expect(result.some(sl => sl.time === '13:00')).toBe(true)
  })

  // 6. findNextAvailableSlots לא מחזירה שעות שכבר עברו
  it('6 — findNextAvailableSlots does not return hours that have already passed today', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const sb = mockSb()
    const result = await findNextAvailableSlots(
      sb, 'biz1', today, 14, 'הלבנה', responsibilities, schedule, {}, 60, undefined, 10
    )
    expect(result.some(sl => sl.date === today && sl.time === '11:00')).toBe(false)
    expect(result.some(sl => sl.date === today && sl.time === '13:00')).toBe(true)
  })

  // 7. findAvailableDoctorForExactSlot לא מאשרת slot בעבר
  it('7 — findAvailableDoctorForExactSlot never approves a slot already in the past', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const sb = mockSb()
    const result = await findAvailableDoctorForExactSlot(
      sb, 'biz1', today, '11:00', 60, 'הלבנה', responsibilities, schedule, {}
    )
    expect(result.status).not.toBe('available')
  })

  // 8. saveOrRescheduleBotAppointment לא מאפשר קביעה לזמן שכבר עבר —
  // בודקים ספציפית את השכבה החדשה (meetsMinLeadTime), לא את מנגנון
  // ה"תאריך בעבר" הישן: 30 דק' בעבר נמצא בתוך חלון החסד של שעה של המנגנון
  // הישן (לא נדחה/מתגלגל שם), כך שהוא מגיע לשלב שיוך הרופא — ושם נדחה עכשיו
  it('8 — saveOrRescheduleBotAppointment refuses a booking 30 minutes in the past (within the old date_in_past grace window, blocked by the new min-lead-time rule instead)', async () => {
    const sb = mockSb()
    const past = new Date(Date.now() - 30 * 60000)
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(past)
    const get = (t: string) => fmt.find(p => p.type === t)?.value || ''
    const date = `${get('year')}-${get('month')}-${get('day')}`
    const time = `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`

    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date, time, service: 'הלבנה',
      empResponsibilities: responsibilities,
      employeeMinLeadHours: {}, // אובייקט אמיתי (לא undefined) — מפעיל את הבדיקה בכלל, ר' saveOrRescheduleBotAppointment
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
    expect(sb.state.lastAssignedTo).toBeFalsy()
  })
})

// ─── saveOrRescheduleBotAppointment — strictServiceDoctorBooking ────────────
// (דרישה עסקית, strict mode): ברירת מחדל false/undefined = בדיוק
// ההתנהגות הקיימת, ללא שינוי — כל הבדיקות למעלה (בלי strict) ממשיכות
// לעבור בדיוק כמו קודם. true מהדק: קביעה אוטומטית מתאפשרת רק עם רופא/ה
// עם יומן פתוח מאומת בפועל
describe('saveOrRescheduleBotAppointment — strictServiceDoctorBooking (opt-in, default false = no behavior change)', () => {
  const DOC_A = 'doc-a'

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

  it('allows booking normally (backward compatible) when strictServiceDoctorBooking is not set, even with no doctor mapping at all', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'בדיקה',
      empResponsibilities: {}, // אין שום שיוך שירותים בעסק
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBeFalsy() // נשמר בלי רופא/ה משויכ/ת, בדיוק כמו קודם
  })

  it('blocks booking when strict and there is no doctor↔service mapping at all for the business (unverified)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'בדיקה',
      empResponsibilities: {},
      strictServiceDoctorBooking: true,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  it('blocks booking when strict and the service is known but no doctor is mapped to it (no_match)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'הלבנה',
      empResponsibilities: { [DOC_A]: ['השתלות'] },
      strictServiceDoctorBooking: true,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  it('blocks booking when strict and the mapped doctor has no employee_schedules defined at all (unverified — cannot confirm an open calendar)', async () => {
    const tuesday = nextWeekday(2)
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'] },
      employeeSchedules: {},
      strictServiceDoctorBooking: true,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_doctor_available')
  })

  it('allows booking when strict and the mapped doctor has a verified, open schedule (has_calendar)', async () => {
    const tuesday = nextWeekday(2)
    const day = 'שלישי'
    const sb = mockSb()
    const r = await saveOrRescheduleBotAppointment(sb, {
      ...baseParams, date: tuesday, time: '12:00', service: 'השתלות',
      empResponsibilities: { [DOC_A]: ['השתלות'] },
      employeeSchedules: { [DOC_A]: [{ day, open: '09:00', close: '17:00', closed: false }] },
      strictServiceDoctorBooking: true,
    })
    expect(r.ok).toBe(true)
    expect(sb.state.lastAssignedTo).toBe(DOC_A)
  })
})

// ─── getServiceDoctorAvailabilityStatus — דרישה עסקית 4/5/6 ─────────────────
// closed:true הוא חסימת-קביעה-אוטומטית מכוונת (מומחה שמתואם ידנית), לא
// "הטיפול לא ניתן"/"אין תורים בכלל" — והיעדר שיוך ודאי בין שירות לרופא/ה
// אסור לנחש, מעבירים לבדיקה אנושית. ארבע תוצאות אפשריות: no_match/
// unverified/fully_blocked/has_calendar — ר' ההערה המלאה מעל ההגדרה עצמה
describe('getServiceDoctorAvailabilityStatus', () => {
  it('1 — no_match when no service is known at all', () => {
    expect(getServiceDoctorAvailabilityStatus(null, { docA: ['הלבנה'] }, {})).toBe('no_match')
  })

  // (ביקורת קוד): unverified, לא has_calendar — "אין מידע לחסום
  // לפיו" הוא לא אותו דבר כמו "וידאתי שיש יומן פתוח". route.ts מטפל
  // ב-unverified בפועל בדיוק כמו has_calendar כברירת מחדל (permissive,
  // אותה התנהגות בדיוק כמו לפני התיקון — ר' shouldForceHandoff), אלא אם
  // business.settings.strict_service_doctor_booking===true
  it('2 — unverified (not has_calendar!) when there is no doctor-service mapping defined for the business at all — no data exists to verify against', () => {
    expect(getServiceDoctorAvailabilityStatus('הלבנה', {}, {})).toBe('unverified')
  })

  it('3 — no_match when the service is known but no doctor is mapped to it (no guessing, escalate)', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    expect(getServiceDoctorAvailabilityStatus('הלבנה', empResponsibilities, { docA: [] })).toBe('no_match')
  })

  it('4 — fully_blocked when the mapped doctor exists but has zero open days (closed:true every day — a specialist coordinated manually, not "unavailable")', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = {
      docA: [
        { day: 'ראשון', open: '', close: '', closed: true },
        { day: 'שני', open: '', close: '', closed: true },
      ],
    }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('fully_blocked')
  })

  it('5 — has_calendar when at least one mapped doctor has at least one open day', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = {
      docA: [
        { day: 'ראשון', open: '', close: '', closed: true },
        { day: 'שני', open: '09:00', close: '17:00', closed: false },
      ],
    }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('has_calendar')
  })

  // (ביקורת קוד): unverified, לא has_calendar — יש שיוך שירות-רופא,
  // אבל אין שום דרך לאמת שהיומן באמת פתוח (אין employee_schedules בכלל)
  it('6 — unverified (not has_calendar!) when the doctor is mapped but has no schedule defined at all — cannot verify an open calendar', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, {})).toBe('unverified')
  })

  it('8 — unverified takes priority over fully_blocked when doctors are mixed: at least one qualified doctor has no schedule at all, and none of the ones with a schedule are open', () => {
    const empResponsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
    const employeeSchedules = {
      docA: [{ day: 'ראשון', open: '', close: '', closed: true }], // יש לוח, סגור לגמרי
      // docB: אין לו/ה שום employee_schedules בכלל
    }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('unverified')
  })

  it('9 — has_calendar takes priority over unverified when at least one qualified doctor is verified open, even if another has no schedule at all', () => {
    const empResponsibilities = { docA: ['השתלות'], docB: ['השתלות'] }
    const employeeSchedules = {
      docA: [{ day: 'ראשון', open: '09:00', close: '17:00', closed: false }], // מאומת פתוח
      // docB: אין לו/ה שום employee_schedules בכלל
    }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('has_calendar')
  })

  it('7 — a known treatment alias (סתימה) still resolves against the configured category name (טיפולים משמרים), matching the existing SERVICE_SYNONYM_GROUPS behavior — not a raw string match', () => {
    // matchServiceReason/resolveActiveService already fold "סתימה"/"עקירה" into
    // the formal category "טיפולים משמרים" before this function ever runs —
    // this test locks in that the resolved category is what must be passed in,
    // and that it correctly finds the doctor mapped to that formal category
    const empResponsibilities = { docA: ['טיפולים משמרים'] }
    const employeeSchedules = { docA: [{ day: 'ראשון', open: '09:00', close: '17:00', closed: false }] }
    expect(getServiceDoctorAvailabilityStatus('טיפולים משמרים', empResponsibilities, employeeSchedules)).toBe('has_calendar')
  })

  // (ביקורת קוד): closed:false לבד לא מספיק — שורה עם שעות חסרות/פסולות
  // אינה הוכחה אמיתית ל"יומן פתוח". unverified, לא has_calendar
  it('10 — unverified (not has_calendar!) when the only non-closed row is missing valid open/close times', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = { docA: [{ day: 'ראשון', open: '', close: '', closed: false }] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('unverified')
  })

  it('11 — unverified (not has_calendar!) when the only non-closed row has an invalid day name', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = { docA: [{ day: 'יום-לא-קיים', open: '09:00', close: '17:00', closed: false }] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('unverified')
  })

  it('12 — unverified (not has_calendar!) when the only non-closed row has close <= open (invalid range)', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = { docA: [{ day: 'ראשון', open: '17:00', close: '09:00', closed: false }] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('unverified')
  })

  it('13 — fully_blocked is unaffected: an explicitly closed:true row is never reclassified as unverified just because it also lacks open/close times', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = { docA: [{ day: 'ראשון', open: '', close: '', closed: true }] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('fully_blocked')
  })

  it('14 — has_calendar still wins when one row is malformed (unverified-leaning) but another row for the same doctor is genuinely verified open', () => {
    const empResponsibilities = { docA: ['השתלות'] }
    const employeeSchedules = { docA: [
      { day: 'ראשון', open: '', close: '', closed: false }, // פגום, לא נחשב הוכחה לסגור או לפתוח
      { day: 'שני', open: '09:00', close: '17:00', closed: false }, // מאומת פתוח
    ] }
    expect(getServiceDoctorAvailabilityStatus('השתלות', empResponsibilities, employeeSchedules)).toBe('has_calendar')
  })
})
