import { createClient } from '@/lib/supabase/server'
import LeadForm from '@/components/LeadForm'

export default async function NewLeadPage() {
  const supabase = await createClient()
  const { data: profiles } = await supabase.from('profiles').select('*')

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ליד חדש</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>הוסף ליד חדש למערכת</p>
      </div>
      <LeadForm profiles={profiles || []} />
    </div>
  )
}
