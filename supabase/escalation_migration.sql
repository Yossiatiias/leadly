-- ─── אסקלציה לנציג אנושי — הבוט מבטיח "אעביר אותך לנציג" ומפעיל בפועל ───────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_escalated_at ON conversations (escalated_at);

-- הערה: notification_settings לא דורש migration — נשמר תחת businesses.settings.notifications
-- (אותו JSONB שכבר מחזיק services/working_hours/agent_instructions וכו')
