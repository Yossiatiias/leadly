import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { email, full_name, role, business_id } = await req.json()
    if (!email || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 })
    }

    // Create user via Supabase admin API (sends invite email)
    const { data: user, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role: role || 'agent', business_id },
    })
    if (authErr) throw authErr

    // Upsert profile linked to this business
    if (user?.user?.id) {
      await supabase.from('profiles').upsert({
        id: user.user.id,
        email,
        full_name: full_name || null,
        role: role || 'agent',
        business_id,
      }, { onConflict: 'id' })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('invite error:', err)
    return NextResponse.json({ error: err?.message || 'שגיאה בהזמנה' }, { status: 500 })
  }
}
