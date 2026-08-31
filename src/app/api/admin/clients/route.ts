import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: callerProfile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'superadmin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch all businesses
  const { data: businesses } = await adminSupabase
    .from('businesses')
    .select('id, name, created_at, settings')
    .order('created_at', { ascending: false })

  // Fetch one admin profile per business
  const businessIds = (businesses || []).map(b => b.id)
  const { data: profiles } = await adminSupabase
    .from('profiles')
    .select('id, full_name, business_id, role')
    .in('business_id', businessIds.length ? businessIds : [''])
    .in('role', ['admin', 'superadmin'])

  // Fetch WhatsApp connections
  const { data: connections } = await adminSupabase
    .from('whatsapp_connections')
    .select('business_id, instance_id, status')
    .in('business_id', businessIds.length ? businessIds : [''])

  const clients = (businesses || []).map(b => {
    const adminProfile = (profiles || []).find(p => p.business_id === b.id)
    const wa = (connections || []).find(c => c.business_id === b.id)
    return {
      id: b.id,
      name: b.name,
      created_at: b.created_at,
      onboarding_completed: b.settings?.onboarding_completed ?? false,
      admin_name: adminProfile?.full_name || null,
      whatsapp_connected: !!wa?.instance_id,
      whatsapp_status: wa?.status || null,
    }
  })

  return NextResponse.json({ clients })
}
