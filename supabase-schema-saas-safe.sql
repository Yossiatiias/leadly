-- ================================================
-- SaaS Schema - SAFE VERSION (לא פוגע בטבלאות קיימות)
-- מוסיף רק טבלאות חדשות + עמודות חסרות
-- ================================================

-- ------------------------------------------------
-- 1. businesses (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL,
  logo_url TEXT,
  industry TEXT,
  address TEXT,
  website TEXT,
  plan TEXT DEFAULT 'trial',
  plan_expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}'
);

-- ------------------------------------------------
-- 2. הוסף business_id לטבלת profiles הקיימת
-- ------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ------------------------------------------------
-- 3. whatsapp_connections (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL UNIQUE,
  instance_id TEXT NOT NULL,
  api_token TEXT NOT NULL,
  api_url TEXT DEFAULT 'https://7107.api.greenapi.com',
  bot_enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'connected',
  last_message_at TIMESTAMP WITH TIME ZONE,
  meta_data JSONB DEFAULT '{}'
);

-- ------------------------------------------------
-- 4. qa_knowledge (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true
);

-- ------------------------------------------------
-- 5. conversations (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  status TEXT DEFAULT 'active',
  bot_enabled BOOLEAN DEFAULT true,
  ai_summary TEXT,
  ai_recommendation TEXT,
  lead_id UUID,
  UNIQUE(business_id, contact_phone)
);

-- ------------------------------------------------
-- 6. messages (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  direction TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  whatsapp_message_id TEXT,
  sender_type TEXT DEFAULT 'ai'
);

-- ------------------------------------------------
-- 7. saas_leads (לידים מהמערכת החדשה — שם שונה כדי לא להתנגש)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new',
  ai_summary TEXT,
  ai_recommendation TEXT,
  notes TEXT,
  next_followup TIMESTAMP WITH TIME ZONE,
  last_contacted TIMESTAMP WITH TIME ZONE
);

-- עדכן conversations שיצביע על saas_leads
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS saas_lead_id UUID REFERENCES saas_leads(id);

-- ------------------------------------------------
-- 8. appointments (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  saas_lead_id UUID REFERENCES saas_leads(id),
  conversation_id UUID REFERENCES conversations(id),
  contact_name TEXT,
  contact_phone TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'pending',
  notes TEXT
);

-- ------------------------------------------------
-- 9. followup_tasks (חדש לגמרי)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS followup_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  saas_lead_id UUID REFERENCES saas_leads(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE
);

-- ================================================
-- TRIGGERS
-- ================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER saas_leads_updated_at
  BEFORE UPDATE ON saas_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================
-- ROW LEVEL SECURITY
-- ================================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_tasks ENABLE ROW LEVEL SECURITY;

-- פונקציה: מחזירה את ה-business_id של המשתמש המחובר
CREATE OR REPLACE FUNCTION get_user_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Policies
CREATE POLICY "business_isolation" ON businesses
  FOR ALL TO authenticated USING (id = get_user_business_id());

CREATE POLICY "business_isolation" ON whatsapp_connections
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON qa_knowledge
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON conversations
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON messages
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON saas_leads
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON appointments
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON followup_tasks
  FOR ALL TO authenticated USING (business_id = get_user_business_id());

-- Service role policies (לוובהוק)
CREATE POLICY "service_role_all" ON whatsapp_connections
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON conversations
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON messages
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON saas_leads
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON followup_tasks
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON appointments
  FOR ALL TO service_role USING (true);
