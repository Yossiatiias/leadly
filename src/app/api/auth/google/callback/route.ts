import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const businessId = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !businessId) {
    return NextResponse.redirect('https://betterlead.vercel.app/settings?tab=connections&gcal=error')
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: 'https://betterlead.vercel.app/api/auth/google/callback',
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenRes.json()
  if (!tokens.access_token) {
    return NextResponse.redirect('https://betterlead.vercel.app/settings?tab=connections&gcal=error')
  }

  // Get connected email
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json()

  // Save tokens to businesses.settings
  const { data: biz } = await supabase
    .from('businesses').select('settings').eq('id', businessId).single()

  const settings = (biz?.settings || {}) as Record<string, unknown>
  settings.google_calendar = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   Date.now() + (tokens.expires_in ?? 3600) * 1000,
    email:         info.email ?? '',
    connected_at:  new Date().toISOString(),
  }

  await supabase.from('businesses').update({ settings }).eq('id', businessId)

  return NextResponse.redirect('https://betterlead.vercel.app/settings?tab=connections&gcal=ok')
}
