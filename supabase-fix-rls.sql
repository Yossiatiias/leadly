-- ================================================
-- FIX: Multi-tenant isolation for original tables
-- הרץ את זה ב-Supabase SQL Editor
-- ================================================

-- 1. הוסף business_id לטבלת leads המקורית (אם לא קיים)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- 2. הוסף business_id לטבלת lead_activities (אם לא קיים)
ALTER TABLE lead_activities ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;

-- 3. מחק פוליסות ישנות שמאפשרות הכל
DROP POLICY IF EXISTS "משתמשים מחוברים רואים הכל" ON profiles;
DROP POLICY IF EXISTS "משתמשים מחוברים רואים לידים" ON leads;
DROP POLICY IF EXISTS "משתמשים מחוברים רואים פעולות" ON lead_activities;

-- 4. פוליסה חדשה ל-profiles:
--    משתמש רואה רק פרופילים מהעסק שלו + את הפרופיל שלו עצמו
CREATE POLICY "business_isolation" ON profiles
  FOR ALL TO authenticated
  USING (
    business_id = get_user_business_id()
    OR id = auth.uid()
  );

-- 5. פוליסה חדשה ל-leads: רק הנתונים של העסק
CREATE POLICY "business_isolation" ON leads
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

-- 6. פוליסה חדשה ל-lead_activities: דרך business_id
CREATE POLICY "business_isolation" ON lead_activities
  FOR ALL TO authenticated
  USING (business_id = get_user_business_id());

-- 7. service_role יכול לכתוב ל-leads (מה-AI webhook)
CREATE POLICY "service_role_all" ON leads
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all" ON lead_activities
  FOR ALL TO service_role USING (true);
