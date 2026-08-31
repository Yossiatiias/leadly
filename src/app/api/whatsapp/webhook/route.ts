import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ingestIncomingMessages } from '@/lib/whatsappIngest'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { typeWebhook, instanceData } = body

    console.log('[webhook] typeWebhook:', typeWebhook)

    // נטפל בכל webhook שקשור להודעה נכנסת — גם quotaExceeded משמש כטריגר
    const isRelevant = [
      'incomingMessageReceived',
      'quotaExceeded',
    ].includes(typeWebhook)

    if (!isRelevant) return NextResponse.json({ ok: true })

    const rawInstanceId: string = instanceData?.idInstance?.toString() || ''
    // Normalize: strip "Instance " prefix that users sometimes paste from Green API console
    const instanceId = rawInstanceId.replace(/^Instance\s+/i, '').trim()
    if (!instanceId) return NextResponse.json({ ok: true })

    // מצא עסק לפי instance
    const { data: connection } = await supabase
      .from('whatsapp_connections')
      .select('business_id, bot_enabled, api_token, api_url')
      .or(`instance_id.eq.${instanceId},instance_id.eq.Instance ${instanceId}`)
      .single()

    if (!connection?.bot_enabled) {
      console.log('[webhook] no connection or bot disabled')
      return NextResponse.json({ ok: true })
    }

    const businessId = connection.business_id
    const greenUrl = connection.api_url || 'https://7107.api.greenapi.com'
    const greenToken = connection.api_token

    // ─── במקום לסמוך על תוכן ה-webhook, שאל את Green API ישירות ───────────
    const msgsRes = await fetch(
      `${greenUrl}/waInstance${instanceId}/lastIncomingMessages/${greenToken}?minutes=3`
    )

    if (!msgsRes.ok) {
      console.log('[webhook] lastIncomingMessages failed:', msgsRes.status)
      return NextResponse.json({ ok: true })
    }

    const incomingMsgs: any[] = await msgsRes.json()
    console.log('[webhook] lastIncomingMessages count:', incomingMsgs?.length)

    if (!Array.isArray(incomingMsgs) || incomingMsgs.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
      `${req.headers.get('x-forwarded-proto')}://${req.headers.get('host')}`

    const { processed } = await ingestIncomingMessages(supabase, businessId, incomingMsgs, baseUrl)
    console.log('[webhook] processed new messages:', processed)

    return NextResponse.json({ ok: true })

  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Green API שולח GET לאימות
export async function GET() {
  return NextResponse.json({ ok: true, service: 'Leadly WhatsApp Webhook' })
}
