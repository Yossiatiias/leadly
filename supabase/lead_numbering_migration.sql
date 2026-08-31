-- ─── מספור לידים אוטומטי, לפי עסק (A1, A2, A3...) ──────────────────────────
-- כל עסק מתחיל מ-1 בנפרד (SaaS רב-לקוחות — אין טעם במספר רציף על פני כל
-- הלקוחות). הרצה חד-פעמית ב-Supabase SQL Editor.

-- טבלת מונים — שורה אחת לכל עסק, next_number = המספר הבא שיוקצה
CREATE TABLE IF NOT EXISTS lead_number_counters (
  business_id  UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  next_number  INTEGER NOT NULL DEFAULT 1
);

-- הקצאה אטומית: UPDATE...RETURNING תחת נעילת שורה מונע מרוץ בין שני
-- INSERT-ים מקבילים על אותו עסק לקבל אותו מספר
CREATE OR REPLACE FUNCTION assign_lead_number() RETURNS TRIGGER AS $$
DECLARE
  assigned INTEGER;
BEGIN
  IF NEW.lead_number IS NULL THEN
    INSERT INTO lead_number_counters (business_id, next_number)
    VALUES (NEW.business_id, 2)
    ON CONFLICT (business_id)
    DO UPDATE SET next_number = lead_number_counters.next_number + 1
    RETURNING next_number - 1 INTO assigned;
    NEW.lead_number := assigned;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_lead_number ON leads;
CREATE TRIGGER trg_assign_lead_number
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION assign_lead_number();

-- ─── Backfill: לידים קיימים ללא מספר, לפי עסק, לפי סדר יצירה ────────────────
WITH ranked AS (
  SELECT id, business_id,
         ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at ASC) AS rn
  FROM leads
  WHERE lead_number IS NULL
)
UPDATE leads l SET lead_number = r.rn
FROM ranked r
WHERE l.id = r.id;

-- ─── אתחול/סנכרון המונה כדי שהבא-בתור ימשיך אחרי המספור הרטרואקטיבי ─────────
INSERT INTO lead_number_counters (business_id, next_number)
SELECT business_id, COALESCE(MAX(lead_number), 0) + 1
FROM leads
WHERE business_id IS NOT NULL
GROUP BY business_id
ON CONFLICT (business_id) DO UPDATE
  SET next_number = GREATEST(lead_number_counters.next_number, EXCLUDED.next_number);
