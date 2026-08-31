import { describe, it, expect } from 'vitest'
import { FakeDb } from '@/test-utils/fakeSupabase'
import { promoteLeadStatusIfAutoManaged } from './leads'
import { AUTO_MANAGED_STATUSES, isAutoManagedStatus } from './botTags'

// ─── Regression: "פותחים את מסך היומן ↔ הבוט מתקדם" לעולם לא ידרוס סטטוס ────
// שנבחר ידנית (יוסי, 30/08). הבאג המקורי הופיע בשני נתיבים נפרדים:
// computeLeadUpdates (הבוט) ו-appointments/page.tsx (retroactive sync +
// יצירת תור + מחיקת תור) — שלושתם וגם הבוט מסתמכים עכשיו על אותה פונקציה/
// אותו allowlist (promoteLeadStatusIfAutoManaged + AUTO_MANAGED_STATUSES),
// אז בדיקה על הפונקציה המשותפת הזו מכסה את כל נקודות הכתיבה בבת אחת —
// לא רק את שני המקרים שכבר תוקנו בעבר

describe('AUTO_MANAGED_STATUSES — the single allowlist source', () => {
  // בכוונה רשימה מפורשת קבועה (יוסי, 30/08) — לא נגזרת מ-STATUS_RANK או
  // מכל רשימה אחרת, כדי שסטטוס שיתווסף אי-פעם ל-STATUS_RANK (או ישתנה
  // שם) לא "יידלף" בטעות להיות סטטוס שמותר למערכת לשנות אוטומטית.
  // published בכוונה **לא** ברשימה — הוא עצמו סטטוס-יעד, לא מקור למעבר
  // אוטומטי כללי; אם הוא נדרש כמקור למעבר נקודתי (מחיקת תור → in_progress)
  // זה מטופל בנפרד באותו flow בלבד, לא דרך הרשימה הכללית הזו
  it('is exactly this fixed, explicit list — not derived from anything else', () => {
    expect([...AUTO_MANAGED_STATUSES].sort()).toEqual(['contacted', 'in_progress', 'new'])
  })

  it('does not include "published" — published is a target, not an auto-manageable source status', () => {
    expect(AUTO_MANAGED_STATUSES.includes('published')).toBe(false)
  })
})

describe('isAutoManagedStatus', () => {
  it('treats null/undefined as auto-managed (a brand-new lead with no status yet)', () => {
    expect(isAutoManagedStatus(null)).toBe(true)
    expect(isAutoManagedStatus(undefined)).toBe(true)
  })

  it('is true for the 3 pre-published lifecycle statuses', () => {
    for (const s of ['new', 'contacted', 'in_progress']) {
      expect(isAutoManagedStatus(s)).toBe(true)
    }
  })

  // published עצמו מוגן כברירת מחדל עכשיו — לא נגזר מ-STATUS_RANK יותר.
  // המעבר הנקודתי היחיד שמותר ממנו (מחיקת תור → in_progress) מטופל
  // בנפרד ב-appointments/page.tsx, לא דרך isAutoManagedStatus הכללי
  it('is false for "published" (it is a destination, not an auto-manageable source)', () => {
    expect(isAutoManagedStatus('published')).toBe(false)
  })

  // המבחן הקריטי מהמפרט: סטטוס עתידי שלא הוגדר באף allowlist היום חייב
  // להיות מוגן אוטומטית, בלי שמפתח יזכור להוסיף אותו לרשימה
  it('protects a made-up future status nobody added to any list ("future_manual_status")', () => {
    expect(isAutoManagedStatus('future_manual_status')).toBe(false)
  })

  it('protects every currently-known manual status', () => {
    for (const s of ['quote_sent', 'quote_followup', 'closed', 'lost', 'not_relevant', 'no_show', 'arrived']) {
      expect(isAutoManagedStatus(s)).toBe(false)
    }
  })
})

describe('promoteLeadStatusIfAutoManaged — the single write path used by every "automatic" status change', () => {
  const PROMOTABLE_TO_PUBLISHED = AUTO_MANAGED_STATUSES.filter(s => s !== 'published')

  // Scenario A מהמפרט: quote_followup + appointment פעיל + "פתיחת" הלוגיקה
  // (promoteLeadStatusIfAutoManaged היא בדיוק מה ש-appointments/page.tsx
  // קורא בטעינה/ביצירת תור) → הסטטוס חייב להישאר quote_followup
  it('does NOT promote quote_followup to published (the exact real-world bug)', async () => {
    const db = new FakeDb()
    db.seed('leads', [{ id: 'lead1', status: 'quote_followup' }])
    const sb = db.client()

    const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)

    expect(changed).toBe(false)
    expect(db.tables.leads[0].status).toBe('quote_followup')
  })

  // "טעינה נוספת" / "Realtime refresh" הם רק עוד קריאות לאותה פונקציה —
  // בהיעדר state שמשתנה, קריאה חוזרת נותנת בדיוק אותה תוצאה (אידמפוטנטי)
  it('stays unchanged across repeated calls (simulating refresh / realtime refetch)', async () => {
    const db = new FakeDb()
    db.seed('leads', [{ id: 'lead1', status: 'quote_followup' }])
    const sb = db.client()

    await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)
    await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)
    await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)

    expect(db.tables.leads[0].status).toBe('quote_followup')
  })

  // שלב 4 מהמפרט: סטטוס דמה שלא קיים היום ולא נוסף לשום רשימה — ההוכחה
  // שהפתרון לא תלוי בזיכרון של מפתח שמעדכן blacklist בכל פעם שנוסף סטטוס
  it('does NOT promote a made-up future status not in any list ("future_manual_status")', async () => {
    const db = new FakeDb()
    db.seed('leads', [{ id: 'lead1', status: 'future_manual_status' }])
    const sb = db.client()

    const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)

    expect(changed).toBe(false)
    expect(db.tables.leads[0].status).toBe('future_manual_status')
  })

  // בדיקות חיוביות — לא מבטלים את האוטומציה הרצויה, רק מגבילים אותה
  for (const from of ['new', 'contacted', 'in_progress']) {
    it(`DOES promote ${from} → published (the automation this exists for)`, async () => {
      const db = new FakeDb()
      db.seed('leads', [{ id: 'lead1', status: from }])
      const sb = db.client()

      const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)

      expect(changed).toBe(true)
      expect(db.tables.leads[0].status).toBe('published')
    })
  }

  // שלב 6 מהמפרט: table-driven על כל סטטוס קיים במערכת (מ-types/index.ts),
  // לא אוסף מקרים ידניים שקל לשכוח לעדכן. כל מה שאינו new/contacted/
  // in_progress אסור להתקדם אוטומטית ל-published
  const ALL_KNOWN_STATUSES = [
    'new', 'contacted', 'in_progress', 'published',
    'not_relevant', 'no_show', 'arrived', 'quote_sent', 'quote_followup', 'closed', 'lost',
  ]
  for (const status of ALL_KNOWN_STATUSES) {
    const shouldPromote = PROMOTABLE_TO_PUBLISHED.includes(status)
    it(`${status} → published is ${shouldPromote ? 'ALLOWED' : 'BLOCKED'}`, async () => {
      const db = new FakeDb()
      db.seed('leads', [{ id: 'lead1', status }])
      const sb = db.client()

      const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'published', PROMOTABLE_TO_PUBLISHED)

      expect(changed).toBe(shouldPromote)
      expect(db.tables.leads[0].status).toBe(shouldPromote ? 'published' : status)
    })
  }

  // מחיקת תור (appointments/page.tsx deleteAppt): ההיפוך published→in_progress
  // מותר רק **מתוך published עצמו** — לא מכל סטטוס ידני אחר. זה נתיב כתיבה
  // שלישי ונפרד מה-retroactive-sync, ונכשל באותה צורה בפועל (30/08)
  describe('the reverse transition (published → in_progress on appointment deletion)', () => {
    it('reverts published → in_progress', async () => {
      const db = new FakeDb()
      db.seed('leads', [{ id: 'lead1', status: 'published' }])
      const sb = db.client()

      const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'in_progress', ['published'])

      expect(changed).toBe(true)
      expect(db.tables.leads[0].status).toBe('in_progress')
    })

    it('does NOT drag quote_followup back to in_progress when its appointment is deleted', async () => {
      const db = new FakeDb()
      db.seed('leads', [{ id: 'lead1', status: 'quote_followup' }])
      const sb = db.client()

      const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'in_progress', ['published'])

      expect(changed).toBe(false)
      expect(db.tables.leads[0].status).toBe('quote_followup')
    })

    it('does NOT drag a made-up future status back to in_progress either', async () => {
      const db = new FakeDb()
      db.seed('leads', [{ id: 'lead1', status: 'future_manual_status' }])
      const sb = db.client()

      const changed = await promoteLeadStatusIfAutoManaged(sb, 'lead1', 'in_progress', ['published'])

      expect(changed).toBe(false)
      expect(db.tables.leads[0].status).toBe('future_manual_status')
    })
  })

  it('returns false and changes nothing when the lead does not exist', async () => {
    const db = new FakeDb()
    db.seed('leads', [])
    const sb = db.client()

    const changed = await promoteLeadStatusIfAutoManaged(sb, 'ghost', 'published', PROMOTABLE_TO_PUBLISHED)

    expect(changed).toBe(false)
  })
})
