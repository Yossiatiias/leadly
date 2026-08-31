import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getAccessToken(businessId: string): Promise<string | null> {
  const { data: biz } = await supabase
    .from('businesses').select('settings').eq('id', businessId).single()

  const gcal = (biz?.settings as Record<string, unknown>)?.google_calendar as Record<string, unknown> | null
  if (!gcal?.access_token) return null

  const expiry = gcal.expiry_date as number
  if (Date.now() < expiry - 60000) return gcal.access_token as string

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: gcal.refresh_token as string,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) return null

  const settings = (biz?.settings || {}) as Record<string, unknown>
  settings.google_calendar = { ...gcal, access_token: data.access_token, expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000 }
  await supabase.from('businesses').update({ settings }).eq('id', businessId)
  return data.access_token
}

export async function POST(req: NextRequest) {
  const { business_id, title, start, end, notes, location } = await req.json()
  if (!business_id || !title || !start) return NextResponse.json({ error: 'missing fields' }, { status: 400 })

  const token = await getAccessToken(business_id)
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 400 })

  const body: Record<string, unknown> = {
    summary:     title,
    description: notes || undefined,
    location:    location || undefined,
    start: { dateTime: new Date(start).toISOString(), timeZone: 'Asia/Jerusalem' },
    end:   { dateTime: new Date(end || new Date(start).getTime() + 30 * 60000).toISOString(), timeZone: 'Asia/Jerusalem' },
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data.error?.message }, { status: 500 })
  return NextResponse.json({ ok: true, gcal_id: data.id })
}
