import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { business_id } = await req.json()
  if (!business_id) return NextResponse.json({ error: 'חסר business_id' }, { status: 400 })

  const { data: biz } = await supabase.from('businesses').select('settings').eq('id', business_id).single()
  await supabase.from('businesses').update({
    settings: { ...(biz?.settings || {}), scan_requested: true }
  }).eq('id', business_id)

  return NextResponse.json({ ok: true })
}
