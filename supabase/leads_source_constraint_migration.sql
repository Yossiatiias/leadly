-- ─── עדכון רשימת "מקור" מותרת לליד — 9 קטגוריות חדשות ──────────────────────
-- הבדיקה בפועל מול ה-DB גילתה constraint פעיל (leads_source_check) שמגביל
-- ל-5 ערכים ישנים בלבד ('backoffice','whatsapp','social','outreach','manual')
-- וחוסם לגמרי כל ליד עם מקור חדש (facebook/instagram/website/other) עד לתיקון.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('whatsapp','manual','backoffice','website','scrape','facebook','instagram','social','other'));
