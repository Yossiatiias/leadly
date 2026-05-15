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
    <div style={{ background: '#0f0e1a', minHeight: '100vh' }}>
      <Sidebar profile={profile} />
      <main style={{ marginRight: '280px', minHeight: '100vh', overflowY: 'auto', overflowX: 'hidden' }}>
        {children}
      </main>
    </div>
  )
}
