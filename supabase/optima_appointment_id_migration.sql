ALTER TABLE appointments ADD COLUMN IF NOT EXISTS optima_appointment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_appointments_optima_id ON appointments(optima_appointment_id) WHERE optima_appointment_id IS NOT NULL;
