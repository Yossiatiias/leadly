-- ================================================
-- SaaS Multi-Tenant Schema - DigiAgent
-- ================================================
-- כל טבלה מכילה business_id לבידוד מלא בין לקוחות

-- ------------------------------------------------
-- businesses (טנאנטים — כל לקוח שקונה את המערכת)
-- ------------------------------------------------
CREATE TABLE businesses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL,
  logo_url TEXT,
  industry TEXT,
  address TEXT,
  website TEXT,
  plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
  plan_expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}'
);

-- ------------------------------------------------
-- profiles (משתמשים — שייכים לעסק אחד)
-- ------------------------------------------------
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'agent')),
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  avatar_url TEXT
);

-- ------------------------------------------------
-- whatsapp_connections (חיבור WhatsApp לעסק — Green API)
-- ------------------------------------------------
CREATE TABLE whatsapp_connections (
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
-- qa_knowledge (מאגר שאלות ותשובות לסוכן ה-AI)
-- ------------------------------------------------
CREATE TABLE qa_knowledge (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true
);

-- ------------------------------------------------
-- conversations (שיחת WhatsApp אחת לכל איש קשר)
-- ------------------------------------------------
CREATE TABLE conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'human_takeover', 'closed')),
  bot_enabled BOOLEAN DEFAULT true,
  ai_summary TEXT,
  ai_recommendation TEXT,
  UNIQUE(business_id, contact_phone)
);

-- ------------------------------------------------
-- messages (הודעות בתוך שיחה)
-- ------------------------------------------------
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio')),
  whatsapp_message_id TEXT,
  sender_type TEXT DEFAULT 'ai' CHECK (sender_type IN ('ai', 'human', 'contact'))
);

-- ------------------------------------------------
-- leads (נוצרים אוטומטית מהשיחות)
-- ------------------------------------------------
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'manual', 'import')),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'followup', 'booked', 'closed', 'not_relevant')),
  ai_summary TEXT,
  ai_recommendation TEXT,
  notes TEXT,
  assigned_to UUID REFERENCES profiles(id),
  next_followup TIMESTAMP WITH TIME ZONE,
  last_contacted TIMESTAMP WITH TIME ZONE
);

-- עדכון conversation עם lead_id אחרי שנוצר
ALTER TABLE conversations ADD COLUMN lead_id UUID REFERENCES leads(id);

-- ------------------------------------------------
-- lead_activities (היסטוריית פעולות על ליד)
-- ------------------------------------------------
CREATE TABLE lead_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  details TEXT
);

-- ------------------------------------------------
-- appointments (תורים שנקבעו ע"י ה-AI)
-- ------------------------------------------------
CREATE TABLE appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id),
  conversation_id UUID REFERENCES conversations(id),
  contact_name TEXT,
  contact_phone TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes TEXT,
  external_calendar_id TEXT
);

-- ------------------------------------------------
-- followup_tasks (פולואפ אוטומטי)
-- ------------------------------------------------
CREATE TABLE followup_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  conversation_id UUID REFERENCES conversations(id),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- ================================================
-- TRIGGERS — עדכון updated_at אוטומטי
-- ================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- יצירת פרופיל אוטומטית בעת הרשמה
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'owner'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ================================================
-- ROW LEVEL SECURITY — כל לקוח רואה רק את הנתונים שלו
-- ================================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_tasks ENABLE ROW LEVEL SECURITY;

-- פונקציה עזר: מחזירה את ה-business_id של המשתמש המחובר
CREATE OR REPLACE FUNCTION get_user_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Policies — כל משתמש רואה רק את הנתונים של העסק שלו
CREATE POLICY "business_isolation" ON businesses
  FOR ALL TO authenticated
  USING (id = get_user_business_id());

CREATE POLICY "business_isolation" ON profiles
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON whatsapp_connections
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON qa_knowledge
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON conversations
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON messages
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON leads
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON lead_activities
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON appointments
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "business_isolation" ON followup_tasks
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

-- Webhook service role (לסוכן ה-AI שכותב הודעות)
-- מאפשר ל-service_role לקרוא ולכתוב ללא RLS
CREATE POLICY "service_role_all" ON whatsapp_connections
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON conversations
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON messages
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON leads
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON followup_tasks
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON appointments
  FOR ALL TO service_role USING (true);
