import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // Auth check — only superadmin can create clients
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

  const { businessName, clientEmail, clientFullName } = await req.json()
  if (!businessName?.trim() || !clientEmail?.trim()) {
    return NextResponse.json({ error: 'שם עסק ואימייל הם שדות חובה' }, { status: 400 })
  }

  // 1. Create business
  const { data: business, error: bizError } = await adminSupabase
    .from('businesses')
    .insert({
      name: businessName.trim(),
      settings: { onboarding_completed: false },
    })
    .select()
    .single()

  if (bizError) return NextResponse.json({ error: bizError.message }, { status: 500 })

  // 2. Invite user + create profile immediately
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://betterlead.vercel.app'
  const { data: invited, error: inviteError } = await adminSupabase.auth.admin.inviteUserByEmail(
    clientEmail.trim(),
    {
      data: {
        business_id: business.id,
        full_name: clientFullName?.trim() || businessName.trim(),
        role: 'admin',
      },
      redirectTo: `${appUrl}/auth/callback?next=/onboarding`,
    }
  )

  if (inviteError) {
    await adminSupabase.from('businesses').delete().eq('id', business.id)
    return NextResponse.json({ error: inviteError.message }, { status: 500 })
  }

  // 3. Create profile so the user has access immediately upon first login
  if (invited?.user?.id) {
    await adminSupabase.from('profiles').upsert({
      id: invited.user.id,
      full_name: clientFullName?.trim() || businessName.trim(),
      role: 'admin',
      business_id: business.id,
    }, { onConflict: 'id' })
  }

  return NextResponse.json({ ok: true, businessId: business.id })
}
