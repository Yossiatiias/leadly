-- ─── סיכום AI לאינטראקציה האחרונה של ליד (מסך "מאגר פונים") ────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_interaction_summary TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_interaction_summarized_at TIMESTAMPTZ;
