import { createClient } from '@/lib/supabase/server'
import LeadForm from '@/components/LeadForm'

export default async function NewLeadPage() {
  const supabase = await createClient()
  const { data: profiles } = await supabase.from('profiles').select('*')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ width: '100%', maxWidth: '640px' }}>
        <div style={{ marginBottom: '24px', textAlign: 'right' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--fg-1)', marginBottom: '4px' }}>ליד חדש</h1>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)' }}>הוסף ליד חדש למערכת</p>
        </div>
        <LeadForm profiles={profiles || []} />
      </div>
    </div>
  )
}
