-- ── מאגר ידע ארגוני ─────────────────────────────────────────────────────────

-- הרחבת qa_knowledge לתמיכה בקבצים ולינקים
ALTER TABLE qa_knowledge
  ADD COLUMN IF NOT EXISTS type        TEXT    DEFAULT 'qa',
  ADD COLUMN IF NOT EXISTS content     TEXT,
  ADD COLUMN IF NOT EXISTS file_url    TEXT,
  ADD COLUMN IF NOT EXISTS source_url  TEXT;

-- Storage bucket לקבצי מאגר הידע
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-files', 'knowledge-files', true)
ON CONFLICT (id) DO NOTHING;

-- מדיניות גישה ל-Storage: כל משתמש מחובר יכול להעלות ולקרוא
CREATE POLICY IF NOT EXISTS "knowledge files upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'knowledge-files');

CREATE POLICY IF NOT EXISTS "knowledge files read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'knowledge-files');

CREATE POLICY IF NOT EXISTS "knowledge files delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'knowledge-files');
