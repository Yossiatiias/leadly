import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function refreshIfNeeded(gcal: Record<string, unknown>, businessId: string) {
  const expiry = gcal.expiry_date as number
  if (Date.now() < expiry - 60000) return gcal.access_token as string

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
  if (!data.access_token) throw new Error('refresh failed')

  // Update stored token
  const { data: biz } = await supabase
    .from('businesses').select('settings').eq('id', businessId).single()
  const settings = (biz?.settings || {}) as Record<string, unknown>
  const updated = { ...(settings.google_calendar as object), access_token: data.access_token, expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000 }
  settings.google_calendar = updated
  await supabase.from('businesses').update({ settings }).eq('id', businessId)

  return data.access_token as string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('business_id')
  if (!businessId) return NextResponse.json({ error: 'missing business_id' }, { status: 400 })

  const { data: biz } = await supabase
    .from('businesses').select('settings').eq('id', businessId).single()

  const gcal = (biz?.settings as Record<string, unknown>)?.google_calendar as Record<string, unknown> | null
  if (!gcal?.access_token) return NextResponse.json({ error: 'not_connected' }, { status: 400 })

  try {
    const accessToken = await refreshIfNeeded(gcal, businessId)

    const now = new Date()
    const future = new Date(now.getTime() + 30 * 86400000)

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin:      now.toISOString(),
        timeMax:      future.toISOString(),
        singleEvents: 'true',
        orderBy:      'startTime',
        maxResults:   '50',
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const calData = await calRes.json()

    const events = (calData.items || []).map((e: Record<string, unknown>) => {
      const start = e.start as Record<string, string>
      const end   = e.end   as Record<string, string>
      return {
        id:       e.id,
        title:    e.summary || '(ללא כותרת)',
        start:    start.dateTime || start.date,
        end:      end.dateTime   || end.date,
        allDay:   !start.dateTime,
        location: e.location || null,
        link:     (e.htmlLink as string) || null,
      }
    })

    return NextResponse.json({ events })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { business_id } = await req.json()
  if (!business_id) return NextResponse.json({ error: 'missing' }, { status: 400 })

  const { data: biz } = await supabase
    .from('businesses').select('settings').eq('id', business_id).single()
  const settings = (biz?.settings || {}) as Record<string, unknown>
  delete settings.google_calendar
  await supabase.from('businesses').update({ settings }).eq('id', business_id)

  return NextResponse.json({ ok: true })
}
