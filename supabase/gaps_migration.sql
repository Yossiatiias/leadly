-- טבלת פערי ידע
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'resolved', 'ignored')),
  asked_count  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_asked_at TIMESTAMPTZ DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_answer TEXT,
  resolved_audience TEXT DEFAULT 'both'
);

ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gaps business access" ON knowledge_gaps
  FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_gaps_business_status ON knowledge_gaps (business_id, status);
CREATE INDEX IF NOT EXISTS idx_gaps_question ON knowledge_gaps (business_id, question);
