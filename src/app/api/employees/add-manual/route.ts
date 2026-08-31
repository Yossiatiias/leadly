import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { full_name, role, business_id } = await req.json()
    if (!full_name || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 })
    }

    // Create an auth user with internal placeholder email (no invite email sent)
    const internalEmail = `internal-${randomUUID()}@noreply.betterlead.local`
    const { data: user, error: authErr } = await supabase.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { full_name, role: role || 'agent', business_id },
    })
    if (authErr) throw authErr

    if (user?.user?.id) {
      const { error: profileErr } = await supabase.from('profiles').upsert({
        id: user.user.id,
        email: internalEmail,
        full_name: full_name || null,
        role: role || 'agent',
        business_id,
      }, { onConflict: 'id' })
      if (profileErr) throw profileErr
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('add-manual error:', err)
    return NextResponse.json({ error: err?.message || 'שגיאה' }, { status: 500 })
  }
}
