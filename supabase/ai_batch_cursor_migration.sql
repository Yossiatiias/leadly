-- ─── תיקון "הודעה נעלמת" (30/08, רחל) ──────────────────────────────────────
-- שומר עד היכן (created_at) ה-batch האחרון של ai-respond הסתכל אחורה על
-- הודעות inbound, כדי שה-handler החיצוני (route.ts POST) יוכל לבדוק בוודאות
-- אחרי כל ריצה: "האם הגיעה הודעת לקוח שהריצה הזו לא ראתה בכלל?" ולעבד אותה
-- מיד אחרי, בלי להמתין לטריגר נפרד שעלול להיחסם ע"י ה-lock או ה-rate-limit
-- ולהיעלם. ראה handleAiRespond ו-POST ב-ai-respond/route.ts.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_last_batch_at TIMESTAMPTZ;
