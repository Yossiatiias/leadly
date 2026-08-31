-- ─── מצב זיהוי מגדר/שם לכל שיחה — למניעת בלבול זכר/נקבה ופנייה בשם שגוי ────
-- נשמר על conversations (לא על leads — זה מיועד ל"איך הבוט פונה", לא לרשומת
-- ה-CRM שכבר יש לה name/first_name/last_name נפרדים ולא נגעתי בהם).

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gender_state TEXT NOT NULL DEFAULT 'unknown'
  CHECK (gender_state IN ('unknown', 'male', 'female'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gender_confidence REAL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gender_evidence TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS verified_first_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS verified_first_name_source TEXT
  CHECK (verified_first_name_source IS NULL OR verified_first_name_source IN ('explicit_user_message', 'verified_metadata'));
