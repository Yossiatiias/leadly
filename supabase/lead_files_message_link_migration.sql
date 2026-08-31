ALTER TABLE lead_files ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id);
CREATE INDEX IF NOT EXISTS idx_lead_files_message_id ON lead_files(message_id) WHERE message_id IS NOT NULL;
