-- מאפשר ל-Supabase Realtime לשדר שינויים בטבלאות conversations/messages
-- לדפדפן (postgres_changes ב-conversations/page.tsx). בלי זה, ה-subscribe
-- נרשם בהצלחה בלי שגיאה, אבל אף אירוע לא מגיע בפועל — נראה כאילו "אין
-- ריענון אוטומטי" למרות שהקוד מוגדר נכון. אידמפוטנטי: לא נכשל אם הטבלה
-- כבר חברה בפרסום.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
