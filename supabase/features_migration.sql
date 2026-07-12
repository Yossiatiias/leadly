-- ─── Feature migrations ───────────────────────────────────────────────────────

-- סוג טיפול בלידים
ALTER TABLE leads ADD COLUMN IF NOT EXISTS treatment_type TEXT;

-- הפרדת קהל יעד במאגר הידע
ALTER TABLE qa_knowledge ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT 'both';

-- ─── טבלת תורים ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  patient_name     TEXT NOT NULL,
  patient_phone    TEXT,
  treatment_type   TEXT,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','arrived','no_show','completed','cancelled')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments business access" ON appointments
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_appointments_business_date ON appointments (business_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_lead ON appointments (lead_id);
