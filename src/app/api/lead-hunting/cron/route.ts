import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Called by Vercel cron every hour — finds businesses due for a scan and triggers them
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date().toISOString()

  // Fetch all businesses that have scheduled scanning enabled
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, settings')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const due = (businesses || []).filter(biz => {
    const schedule = biz.settings?.hunt_schedule
    if (!schedule?.enabled) return false
    if (!biz.settings?.hunt_sources?.length) return false
    if (!schedule.next_scan_at) return true
    return new Date(schedule.next_scan_at) <= new Date(now)
  })

  if (due.length === 0) return NextResponse.json({ ok: true, triggered: 0 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://leadly-zeta.vercel.app'
  const results: { business_id: string; status: string }[] = []

  for (const biz of due) {
    const sources: { url: string }[] = biz.settings.hunt_sources || []
    const schedule = biz.settings.hunt_schedule
    const intervalHours: number = schedule.interval_hours || 24
    const nextScan = new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()

    try {
      const webhookUrl = `${appUrl}/api/lead-hunting/ingest?business_id=${biz.id}`

      const res = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(process.env.APIFY_ACTOR_ID!)}/runs?token=${process.env.APIFY_API_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startUrls: sources.map(s => ({ url: s.url })),
            resultsAmount: 50,
            webhooks: [{ eventTypes: ['ACTOR.RUN.SUCCEEDED'], requestUrl: webhookUrl }],
          }),
          signal: AbortSignal.timeout(15000),
        }
      )

      if (res.ok) {
        await supabase.from('businesses').update({
          settings: {
            ...biz.settings,
            hunt_schedule: {
              ...schedule,
              last_scan_at: now,
              next_scan_at: nextScan,
            },
          },
        }).eq('id', biz.id)
        results.push({ business_id: biz.id, status: 'triggered' })
      } else {
        results.push({ business_id: biz.id, status: 'apify_error' })
      }
    } catch {
      results.push({ business_id: biz.id, status: 'error' })
    }
  }

  return NextResponse.json({ ok: true, triggered: results.filter(r => r.status === 'triggered').length, results })
}
