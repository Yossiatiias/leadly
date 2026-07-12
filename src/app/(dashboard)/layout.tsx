import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'

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
      <main style={{ marginRight: '240px', minHeight: '100vh', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          {children}
        </div>
        <footer style={{ textAlign: 'center', padding: '16px', fontSize: '11px', color: 'var(--fg-4)', borderTop: '1px solid var(--border-subtle)', marginTop: '40px' }}>
          © Leadly 2026 — כל הזכויות שמורות
        </footer>
      </main>
    </div>
  )
}
