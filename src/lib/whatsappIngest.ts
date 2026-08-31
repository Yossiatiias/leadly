/* eslint-disable @typescript-eslint/no-explicit-any */
import { after } from 'next/server'
import { ensureLeadExists } from '@/lib/leads'

// ─── עיבוד הודעות נכנסות מ-Green API — משותף בין webhook.ts (בזמן אמת) ──────
// לבין cron/reconcile-messages.ts (רשת ביטחון תקופתית שתופסת הודעות שנפלו
// כשה-webhook לא הופעל בכלל, למשל בזמן שהחיבור הושעה אצל Green API — קרה
// בפועל: לקוח שלח הודעה, Green API קיבל אותה בעצמו, אבל מעולם לא שלח
// webhook אלינו כי ה-instance היה "suspended". בלי הרשת הזו היינו מגלים
// רק כשלקוח מתלונן שלא ענו לו)

const MEDIA_TYPE_LABELS: Record<string, string> = {
  imageMessage: '[תמונה]',
  videoMessage: '[סרטון]',
  documentMessage: '[מסמך]',
  audioMessage: '[הודעה קולית]',
}

function extractMedia(msg: any): { downloadUrl: string; caption: string; fileName: string; mimeType: string } | null {
  const type = msg.typeMessage
  if (!type || !MEDIA_TYPE_LABELS[type]) return null
  const fmd = msg.fileMessageData || {}
  const downloadUrl = msg.downloadUrl || fmd.downloadUrl || ''
  if (!downloadUrl) return null
  return {
    downloadUrl,
    caption: msg.caption || fmd.caption || '',
    fileName: msg.fileName || fmd.fileName || `file_${Date.now()}`,
    mimeType: msg.mimeType || fmd.mimeType || 'application/octet-stream',
  }
}

export async function ingestIncomingMessages(
  sb: any,
  businessId: string,
  incomingMsgs: any[],
  baseUrl: string
): Promise<{ processed: number }> {
  let processed = 0

  for (const msg of incomingMsgs) {
    const chatId: string = msg.chatId || ''
    if (chatId.includes('@g.us')) continue // דלג על קבוצות

    const senderPhone = chatId.replace('@c.us', '')
    const media = extractMedia(msg)
    const messageText: string =
      msg.textMessage ||
      msg.extendedTextMessage?.text ||
      media?.caption ||
      (media ? MEDIA_TYPE_LABELS[msg.typeMessage] : '') || ''
    const messageId: string = msg.idMessage || ''

    if (!messageText || !senderPhone || !messageId) continue

    const { data: existing } = await sb
      .from('messages')
      .select('id')
      .eq('whatsapp_message_id', messageId)
      .maybeSingle()

    if (existing) continue

    let { data: conversation } = await sb
      .from('conversations')
      .select('*')
      .eq('business_id', businessId)
      .eq('contact_phone', senderPhone)
      .maybeSingle()

    if (!conversation) {
      const { data: newConv } = await sb
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

    const { data: insertedMsg, error: insertMsgError } = await sb.from('messages').insert({
      conversation_id: conversation.id,
      business_id: businessId,
      direction: 'inbound',
      content: messageText,
      sender_type: 'contact',
      whatsapp_message_id: messageId,
      created_at: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
    }).select('id').single()

    if (insertMsgError) continue

    processed++

    await sb.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation.id)

    if (media) {
      try {
        const leadId = await ensureLeadExists(sb, conversation.id, businessId, senderPhone, messageText)
        if (leadId) {
          const fileRes = await fetch(media.downloadUrl)
          if (fileRes.ok) {
            const buffer = Buffer.from(await fileRes.arrayBuffer())
            const safeName = media.fileName.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_')
            const path = `${leadId}/${Date.now()}_${safeName}`
            const { error: upErr } = await sb.storage.from('lead-files').upload(path, buffer, { contentType: media.mimeType })
            if (!upErr) {
              const { data: { publicUrl } } = sb.storage.from('lead-files').getPublicUrl(path)
              await sb.from('lead_files').insert({
                lead_id: leadId,
                business_id: businessId,
                message_id: insertedMsg?.id || null,
                file_name: media.fileName,
                file_url: publicUrl,
                file_size: buffer.length,
                file_type: media.mimeType,
              })
            }
          }
        }
      } catch (e) {
        console.error('[whatsappIngest] media handling error:', e)
      }
    }

    if (!conversation.bot_enabled || conversation.status === 'human_takeover') continue

    // אם כבר יש בשיחה הודעה (נכנסת או יוצאת) מאוחרת יותר מההודעה הזו —
    // השיחה כבר המשיכה מעבר לנקודה הזו (קרה בפועל ברשת הביטחון היומית:
    // הודעה שנפלה בזמן אמת בגלל תקלת חיבור ישנה, אבל הלקוח והבוט כבר
    // המשיכו ביניהם וסיימו את השיחה בלעדיה). מענה אוטומטי עכשיו על הודעה
    // "ישנה" יהיה מנותק מהקשר ומבלבל — שומרים אותה בהיסטוריה אבל לא מפעילים
    // עליה את הבוט
    const msgCreatedAt = msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString()
    const { data: laterMsg } = await sb
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .gt('created_at', msgCreatedAt)
      .limit(1)
      .maybeSingle()
    if (laterMsg) continue

    const aiPayload = { conversationId: conversation.id, businessId, senderPhone, messageText }
    after(async () => {
      try {
        await fetch(`${baseUrl}/api/whatsapp/ai-respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(aiPayload),
        })
      } catch (e) {
        console.error('[whatsappIngest] ai-respond trigger failed:', e)
      }
    })
  }

  return { processed }
}
