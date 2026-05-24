import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const instanceId: string = instanceData?.idInstance?.toString() || ''
    if (!instanceId) return NextResponse.json({ ok: true })

    // מצא עסק לפי instance
    const { data: connection } = await supabase
      .from('whatsapp_connections')
      .select('business_id, bot_enabled')
      .eq('instance_id', instanceId)
      .single()

    if (!connection?.bot_enabled) {
      console.log('[webhook] no connection or bot disabled')
      return NextResponse.json({ ok: true })
    }

    const businessId = connection.business_id
    const greenUrl = process.env.GREEN_API_URL || 'https://7107.api.greenapi.com'
    const greenToken = process.env.GREEN_API_TOKEN

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

    for (const msg of incomingMsgs) {
      const chatId: string = msg.chatId || ''
      if (chatId.includes('@g.us')) continue // דלג על קבוצות

      const senderPhone = chatId.replace('@c.us', '')
      const messageText: string =
        msg.textMessage ||
        msg.extendedTextMessage?.text || ''
      const messageId: string = msg.idMessage || ''

      if (!messageText || !senderPhone || !messageId) continue

      // בדוק אם כבר עיבדנו את ההודעה הזו
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('whatsapp_message_id', messageId)
        .maybeSingle()

      if (existing) {
        console.log('[webhook] already processed:', messageId)
        continue
      }

      console.log('[webhook] new message from', senderPhone, ':', messageText)

      // מצא או צור שיחה
      let { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('business_id', businessId)
        .eq('contact_phone', senderPhone)
        .maybeSingle()

      if (!conversation) {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            contact_phone: senderPhone,
            contact_name: msg.senderName || null,
            status: 'active',
            bot_enabled: true,
          })
          .select()
          .single()
        conversation = newConv
      }

      if (!conversation) continue
      if (!conversation.bot_enabled || conversation.status === 'human_takeover') continue

      // שמור הודעה נכנסת
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        business_id: businessId,
        direction: 'inbound',
        content: messageText,
        sender_type: 'contact',
        whatsapp_message_id: messageId,
      })

      // קרא ל-ai-respond ברקע
      const aiPayload = {
        conversationId: conversation.id,
        businessId,
        senderPhone,
        messageText,
        instanceId,
      }

      after(async () => {
        try {
          await fetch(`${baseUrl}/api/whatsapp/ai-respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(aiPayload),
          })
        } catch (e) {
          console.error('[webhook] after() error:', e)
        }
      })
    }

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
