import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { group_urls, business_id } = await req.json()
    if (!group_urls?.length || !business_id) {
      return NextResponse.json({ error: 'חסרים פרמטרים' }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://leadly-zeta.vercel.app'
    const webhookUrl = `${appUrl}/api/lead-hunting/ingest?business_id=${business_id}`

    // Start Apify Actor run
    const res = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(process.env.APIFY_ACTOR_ID!)}/runs?token=${process.env.APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: group_urls.map((url: string) => ({ url })),
          resultsAmount: 50,
          webhooks: [{
            eventTypes: ['ACTOR.RUN.SUCCEEDED'],
            requestUrl: webhookUrl,
          }],
        }),
        signal: AbortSignal.timeout(15000),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Apify: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    return NextResponse.json({ ok: true, runId: data?.data?.id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'שגיאה בהפעלת סריקה' }, { status: 500 })
  }
}
