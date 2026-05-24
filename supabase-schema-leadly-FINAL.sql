-- ================================================================
-- LEADLY — Clean Supabase Schema
-- Run this in a fresh Supabase project (SQL Editor → Run)
-- ================================================================

-- ----------------------------------------------------------------
-- 1. profiles
--    Extends auth.users — created automatically on signup
-- ----------------------------------------------------------------
CREATE TABLE profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin', 'sales')),
  business_id  UUID,  -- FK added after businesses table
  email        TEXT,
  avatar_url   TEXT
);

-- ----------------------------------------------------------------
-- 2. businesses
-- ----------------------------------------------------------------
CREATE TABLE businesses (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name             TEXT NOT NULL,
  logo_url         TEXT,
  industry         TEXT,
  address          TEXT,
  website          TEXT,
  plan             TEXT DEFAULT 'trial',
  plan_expires_at  TIMESTAMP WITH TIME ZONE,
  is_active        BOOLEAN DEFAULT true,
  settings         JSONB DEFAULT '{}'
);

ALTER TABLE profiles
  ADD CONSTRAINT profiles_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------
-- 3. leads
-- ----------------------------------------------------------------
CREATE TABLE leads (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id      UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  conversation_id  UUID,  -- FK added after conversations table
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('backoffice','whatsapp','social','outreach','manual')),
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','contacted','in_progress','published','not_relevant')),
  temperature      TEXT NOT NULL DEFAULT 'cold'
                     CHECK (temperature IN ('hot','medium','cold')),
  assigned_to      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes            TEXT,
  campaign_name    TEXT,
  company_name     TEXT,
  clinic_count     INTEGER,
  discount_percent INTEGER,
  next_followup    TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '3 days'),
  last_contacted   TIMESTAMP WITH TIME ZONE
);

-- ----------------------------------------------------------------
-- 4. lead_activities
-- ----------------------------------------------------------------
CREATE TABLE lead_activities (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES profiles(id) NOT NULL,
  type        TEXT NOT NULL DEFAULT 'note'
                CHECK (type IN ('call','whatsapp','note','status_change')),
  action      TEXT NOT NULL,
  details     TEXT,
  outcome     TEXT
);

-- ----------------------------------------------------------------
-- 5. conversations  (WhatsApp chats)
-- ----------------------------------------------------------------
CREATE TABLE conversations (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id        UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  contact_phone      TEXT NOT NULL,
  contact_name       TEXT,
  status             TEXT DEFAULT 'active',
  bot_enabled        BOOLEAN DEFAULT true,
  ai_summary         TEXT,
  ai_recommendation  TEXT,
  lead_id            UUID REFERENCES leads(id) ON DELETE SET NULL,
  UNIQUE(business_id, contact_phone)
);

-- back-fill the FK on leads
ALTER TABLE leads
  ADD CONSTRAINT leads_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------
-- 6. messages
--    Dual use: WhatsApp messages (conversation_id/business_id)
--              Internal team DMs (sender_id/receiver_id)
-- ----------------------------------------------------------------
CREATE TABLE messages (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- WhatsApp fields
  conversation_id      UUID REFERENCES conversations(id) ON DELETE CASCADE,
  business_id          UUID REFERENCES businesses(id) ON DELETE CASCADE,
  direction            TEXT,   -- 'inbound' | 'outbound'
  message_type         TEXT DEFAULT 'text',
  whatsapp_message_id  TEXT,
  sender_type          TEXT DEFAULT 'ai',   -- 'ai' | 'human'
  -- Internal DM fields
  sender_id            UUID REFERENCES profiles(id) ON DELETE SET NULL,
  receiver_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  read_at              TIMESTAMP WITH TIME ZONE,
  -- shared
  content              TEXT NOT NULL
);

-- ----------------------------------------------------------------
-- 7. qa_knowledge  (Bot knowledge base)
-- ----------------------------------------------------------------
CREATE TABLE qa_knowledge (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id  UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  category     TEXT DEFAULT 'general',
  is_active    BOOLEAN DEFAULT true
);

-- ----------------------------------------------------------------
-- 8. whatsapp_connections
-- ----------------------------------------------------------------
CREATE TABLE whatsapp_connections (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  business_id     UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL UNIQUE,
  instance_id     TEXT NOT NULL,
  api_token       TEXT NOT NULL,
  api_url         TEXT DEFAULT 'https://7107.api.greenapi.com',
  bot_enabled     BOOLEAN DEFAULT true,
  status          TEXT DEFAULT 'connected',
  last_message_at TIMESTAMP WITH TIME ZONE,
  meta_data       JSONB DEFAULT '{}'
);

-- ================================================================
-- TRIGGERS — updated_at auto-refresh
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- TRIGGER — auto-create profile on new user signup
-- ================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'admin'   -- first user of a new project is admin
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;

-- Helper: returns the business_id of the logged-in user
CREATE OR REPLACE FUNCTION get_user_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── profiles ──────────────────────────────────────────────────
CREATE POLICY "profiles_same_business"
  ON profiles FOR SELECT TO authenticated
  USING (business_id = get_user_business_id() OR id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- ── businesses ────────────────────────────────────────────────
CREATE POLICY "businesses_own"
  ON businesses FOR ALL TO authenticated
  USING (id = get_user_business_id());

-- ── leads ─────────────────────────────────────────────────────
CREATE POLICY "leads_own_business"
  ON leads FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "leads_service_role"
  ON leads FOR ALL TO service_role USING (true);

-- ── lead_activities ───────────────────────────────────────────
CREATE POLICY "activities_via_lead"
  ON lead_activities FOR ALL TO authenticated
  USING (
    lead_id IN (
      SELECT id FROM leads WHERE business_id = get_user_business_id()
    )
  );

-- ── conversations ─────────────────────────────────────────────
CREATE POLICY "conversations_own_business"
  ON conversations FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "conversations_service_role"
  ON conversations FOR ALL TO service_role USING (true);

-- ── messages ──────────────────────────────────────────────────
-- WhatsApp messages: same business
-- Internal DMs: sender or receiver
CREATE POLICY "messages_whatsapp"
  ON messages FOR ALL TO authenticated
  USING (
    (business_id IS NOT NULL AND business_id = get_user_business_id())
    OR sender_id = auth.uid()
    OR receiver_id = auth.uid()
  );

CREATE POLICY "messages_service_role"
  ON messages FOR ALL TO service_role USING (true);

-- ── qa_knowledge ──────────────────────────────────────────────
CREATE POLICY "qa_own_business"
  ON qa_knowledge FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "qa_service_role"
  ON qa_knowledge FOR ALL TO service_role USING (true);

-- ── whatsapp_connections ──────────────────────────────────────
CREATE POLICY "wc_own_business"
  ON whatsapp_connections FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

CREATE POLICY "wc_service_role"
  ON whatsapp_connections FOR ALL TO service_role USING (true);

-- ================================================================
-- INDEXES (performance)
-- ================================================================
CREATE INDEX idx_leads_business         ON leads(business_id);
CREATE INDEX idx_leads_status           ON leads(status);
CREATE INDEX idx_leads_temperature      ON leads(temperature);
CREATE INDEX idx_conversations_business ON conversations(business_id);
CREATE INDEX idx_conversations_phone    ON conversations(contact_phone);
CREATE INDEX idx_messages_conversation  ON messages(conversation_id);
CREATE INDEX idx_messages_receiver      ON messages(receiver_id) WHERE receiver_id IS NOT NULL;
CREATE INDEX idx_messages_business      ON messages(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX idx_qa_business            ON qa_knowledge(business_id);

-- ================================================================
-- DONE — next steps:
-- 1. Settings > API > copy URL, anon key, service role key
-- 2. Create .env.local in the leadly project (see .env.example)
-- 3. Update Vercel environment variables
-- 4. Invite yourself as user → Authentication > Users > Invite
-- 5. After signup, run in SQL Editor:
--    UPDATE profiles SET business_id = '<YOUR_BUSINESS_UUID>'
--      WHERE id = '<YOUR_USER_UUID>';
--    (or create a business first and link it)
-- ================================================================
