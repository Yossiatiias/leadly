-- ─── מצב "ממתין לחזרה מאוחרת יותר" (REMIND) — לכל שיחה ──────────────────────
-- (דרישה עסקית): נשמר על conversations, לא על leads — זה מיועד ל"האם
-- אנחנו באמצע לאסוף יום/שעה לחזרה מהלקוח", לא לרשומת ה-CRM עצמה (ששם
-- leads.next_followup כבר קיים ומשמש בפועל את תור/תזכורת הנציגה).
-- pending_callback_active: true כל עוד חסר יום או שעה כדי לסגור את הבקשה.
-- pending_callback_date/time: מה שכבר נאסף בהודעה קודמת (חלקי), כדי שהודעת
-- המשך ("מחר ב-14:00", בלי מילת-טריגר) תובן כהשלמת אותה בקשה, לא כבירור
-- טיפול חדש.
--
-- (ביקורת קוד): DATE/TIME ולא TEXT חופשי — נבדקה תאימות מול הקוד בפועל:
-- DATE מוחזר ע"י PostgREST כמחרוזת "YYYY-MM-DD", בדיוק הפורמט שהקוד כבר
-- כותב וקורא (resolveDateMentionInText/israelDateTime) — תואם ישירות,
-- בלי צורך בשינוי קוד. TIME WITHOUT TIME ZONE מוחזר כ-"HH:MM:SS" (עם
-- שניות!) — לא "HH:MM" כמו שהקוד כותב/מצפה — לכן route.ts מנרמל כל קריאה
-- חוזרת של pending_callback_time בחיתוך ל-5 התווים הראשונים (HH:MM) לפני
-- שימוש, כדי לשמור תאימות מלאה עם ה-validation הקיים (extractAllTimesInText/
-- israelDateTime, שדורשים HH:MM בדיוק).

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_callback_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_callback_date DATE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_callback_time TIME WITHOUT TIME ZONE;
