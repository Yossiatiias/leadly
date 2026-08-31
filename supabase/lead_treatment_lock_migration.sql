-- ─── נעילת "סיבת פנייה" אחרי עריכה ידנית ────────────────────────────────────
-- אחרי שנציג מתקן ידנית את treatment_type, הבוט לא ידרוס אותו יותר בהודעה
-- הבאה שבה הוא "מזהה" סיבת פנייה מהשיחה. הרצה חד-פעמית ב-Supabase SQL Editor.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS treatment_type_locked BOOLEAN NOT NULL DEFAULT false;
