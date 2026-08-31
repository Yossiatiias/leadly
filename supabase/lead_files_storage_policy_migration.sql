-- מדיניות גישה ל-Storage עבור באקט lead-files — חסרה לגמרי עד כה, ולכן
-- העלאת קובץ ידנית מהדפדפן (בכרטיס ליד) נכשלה תמיד עם "row-level security
-- policy" violation. קבצים מוואטסאפ עבדו כי הם נכתבים בצד השרת עם מפתח
-- service role שעוקף RLS — רק העלאה ידנית של המשתמש הייתה חסומה.

DROP POLICY IF EXISTS "lead files upload" ON storage.objects;
CREATE POLICY "lead files upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lead-files');

DROP POLICY IF EXISTS "lead files read" ON storage.objects;
CREATE POLICY "lead files read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'lead-files');

DROP POLICY IF EXISTS "lead files delete" ON storage.objects;
CREATE POLICY "lead files delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'lead-files');
