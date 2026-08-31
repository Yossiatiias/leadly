import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import StaffChatWidget from '@/components/StaffChatWidget'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <div style={{ background: 'var(--bg-canvas)', minHeight: '100vh' }}>
      <Sidebar profile={profile} />
      {/* overflowY/X הוסרו בכוונה (25/08): main כאן היה מוגדר עם minHeight
          בלבד (לא height קבוע), אז overflow-y:auto מעולם לא יצר בפועל
          scrollbar פנימי משלו — הגלילה האמיתית תמיד קרתה במסמך (html/body).
          אבל לפי ה-spec, כל overflow שאינו visible עדיין הופך את main
          ל"scroll container" לצורך position:sticky — מה שגרם לכל sticky
          בתוך main (למשל סרגל התאריך ביומן) להיחשב יחסית לקופסה שאף פעם
          לא באמת גוללת, ולכן "לברוח" מהמסך בגלילה במקום להישאר קבוע.
          עמודים שכן צריכים אזור גלילה פנימי משלהם (שיחות/הודעות/לידים)
          כבר בונים height:100vh + overflow עצמאי לגמרי, בלי תלות ב-main */}
      <main className="dashboard-main" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* דוחף את התוכן מתחת לכפתור ההמבורגר במובייל — תופס-מקום, לא רק חוסם ראייה */}
        <div className="mobile-topbar-spacer" />
        <div style={{ flex: 1 }}>
          {children}
        </div>
        <footer style={{ textAlign: 'center', padding: '16px', fontSize: '11px', color: 'var(--fg-4)', borderTop: '1px solid var(--border-subtle)', marginTop: '40px' }}>
          © BetterLead 2026 — כל הזכויות שמורות
        </footer>
      </main>
      {profile?.business_id && <StaffChatWidget businessId={profile.business_id} />}
    </div>
  )
}
