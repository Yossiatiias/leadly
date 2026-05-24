import { createClient } from '@/lib/supabase/server'
import LeadForm from '@/components/LeadForm'

export default async function NewLeadPage() {
  const supabase = await createClient()
  const { data: profiles } = await supabase.from('profiles').select('*')

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--fg-1)' }}>ליד חדש</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--fg-3)' }}>הוסף ליד חדש למערכת</p>
      </div>
      <LeadForm profiles={profiles || []} />
    </div>
  )
}
