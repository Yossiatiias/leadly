import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Green API webhook payload
    const { typeWebhook, instanceData, senderData, messageData } = body

    // מתעניינים רק בהודעות נכנסות
    if (typeWebhook !== 'incomingMessageReceived') {
      return NextResponse.json({ ok: true })
    }

    // מתעלמים מהודעות קבוצה
    const chatId: string = senderData?.chatId || ''
    if (chatId.includes('@g.us')) {
      return NextResponse.json({ ok: true })
    }

    const instanceId: string = instanceData?.idInstance?.toString() || ''
    const senderPhone: string = chatId.replace('@c.us', '')
    const messageText: string = messageData?.textMessageData?.textMessage ||
                                messageData?.extendedTextMessageData?.text || ''

    if (!messageText || !senderPhone) {
      return NextResponse.json({ ok: true })
    }

    // מצא את העסק לפי ה-instance ID
    const { data: connection } = await supabase
      .from('whatsapp_connections')
      .select('business_id, bot_enabled')
      .eq('instance_id', instanceId)
      .single()

    if (!connection || !connection.bot_enabled) {
      return NextResponse.json({ ok: true })
    }

    const businessId: string = connection.business_id

    // מצא או צור שיחה
    let { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('business_id', businessId)
      .eq('contact_phone', senderPhone)
      .single()

    if (!conversation) {
      const { data: newConversation } = await supabase
        .from('conversations')
        .insert({
          business_id: businessId,
          contact_phone: senderPhone,
          contact_name: senderData?.senderName || null,
          status: 'active',
          bot_enabled: true,
        })
        .select()
        .single()
      conversation = newConversation
    }

    if (!conversation) {
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    // שמור את ההודעה הנכנסת
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      business_id: businessId,
      direction: 'inbound',
      content: messageText,
      sender_type: 'contact',
      whatsapp_message_id: messageData?.idMessage || null,
    })

    // אם הבוט כבוי לשיחה זו — לא לענות
    if (!conversation.bot_enabled || conversation.status === 'human_takeover') {
      return NextResponse.json({ ok: true })
    }

    // שלח לעיבוד AI (async — לא מחכה)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    fetch(`${baseUrl}/api/whatsapp/ai-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversation.id,
        businessId,
        senderPhone,
        messageText,
        instanceId,
      }),
    }).catch(console.error)

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
