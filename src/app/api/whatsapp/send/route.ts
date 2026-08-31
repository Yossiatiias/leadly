import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl, cleanInstanceId } from '@/lib/greenApi'
import { clearDueReminderByConversation } from '@/lib/leadReminders'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// שליחת הודעה ידנית (נציג אנושי) דרך השרת — אותו מסלול מוכח כמו הבוט.
// ההודעה נשמרת במסד רק אחרי ש-Green API אישר את השליחה.
export async function POST(req: NextRequest) {
  try {
    const { conversation_id, business_id, message } = await req.json()
    if (!conversation_id || !business_id || !message?.trim()) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('contact_phone, bot_enabled')
      .eq('id', conversation_id)
      .single()

    if (!conv?.contact_phone) {
      return NextResponse.json({ error: 'שיחה לא נמצאה' }, { status: 404 })
    }

    // כתיבה ידנית מותרת רק כשהסוכן מושהה — מונע מצב שבו הנציג
    // והבוט עונים במקביל לאותו לקוח (החסימה בממשק היא רק שכבה ראשונה)
    if (conv.bot_enabled) {
      return NextResponse.json(
        { error: 'הסוכן פעיל בשיחה זו — יש לעצור אותו לפני כתיבה ידנית' },
        { status: 409 }
      )
    }

    // פרטי חיבור מהמסד (ללא תלות ב-bot_enabled — נציג שולח גם כשהבוט כבוי)
    const { data: connRow } = await supabase
      .from('whatsapp_connections')
      .select('api_token, api_url, instance_id')
      .eq('business_id', business_id)
      .limit(1)
      .maybeSingle()

    // חובה שהחיבור יגיע מהרשומה של העסק הזה בפועל — לא נופלים חזרה למשתני
    // סביבה גלובליים. עם יותר מלקוח פעיל אחד, fallback שקט כזה עלול לגרום
    // לשליחת הודעה מהמספר של עסק אחר. עדיף כישלון מפורש על שקט מסוכן.
    const apiUrl        = connRow?.api_url
    const greenInstance = cleanInstanceId(connRow?.instance_id)
    const greenToken    = connRow?.api_token

    if (!apiUrl || !greenInstance || !greenToken) {
      return NextResponse.json({ error: 'חיבור WhatsApp לא מוגדר לעסק' }, { status: 400 })
    }

    const sendRes = await fetch(
      greenApiUrl(apiUrl, greenInstance, 'sendMessage', greenToken),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${conv.contact_phone}@c.us`, message: message.trim() }),
      }
    )

    if (!sendRes.ok) {
      const errText = await sendRes.text()
      console.error('[whatsapp/send] Green API failed:', sendRes.status, errText)
      return NextResponse.json({ error: `שליחה נכשלה (${sendRes.status})` }, { status: 502 })
    }

    // מזהה ההודעה אצל WhatsApp — משמש לבדיקת מסירה בפועל בהמשך
    let waMessageId: string | null = null
    try {
      const sendJson = await sendRes.json()
      waMessageId = sendJson?.idMessage || null
    } catch { /* אין מזהה — נמשיך בלעדיו */ }

    // התקבל אצל WhatsApp — שומרים במסד
    const { data: inserted, error: insErr } = await supabase.from('messages').insert({
      conversation_id,
      business_id,
      direction: 'outbound',
      content: message.trim(),
      sender_type: 'human',
      whatsapp_message_id: waMessageId,
    }).select().single()

    if (insErr) console.error('[whatsapp/send] message insert failed:', insErr)

    await supabase.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id)

    // יצרנו קשר עם הלקוח — תזכורת שכבר בשלה יורדת מהרשימה
    const reminderCleared = await clearDueReminderByConversation(supabase, conversation_id)

    // ─── אימות מסירה ─────────────────────────────────────────────────────
    // WhatsApp מחזיר "התקבל" מיד, אבל ההודעה עשויה להיתקע בתור ולא להימסר.
    // ממתינים רגע ובודקים אם היא עדיין ממתינה — כדי שהנציג יידע את האמת.
    let delivered: boolean | null = null
    try {
      await new Promise(r => setTimeout(r, 2500))
      const qRes = await fetch(greenApiUrl(apiUrl, greenInstance, 'showMessagesQueue', greenToken))
      if (qRes.ok) {
        const queue = await qRes.json()
        if (Array.isArray(queue)) {
          delivered = !queue.some((q: { messageID?: string; body?: { message?: string } }) =>
            (waMessageId && q.messageID === waMessageId) || q.body?.message === message.trim()
          )
          if (!delivered) {
            console.error('[whatsapp/send] MESSAGE STUCK IN QUEUE — not delivered:', JSON.stringify({
              conversation_id, waMessageId, queueSize: queue.length,
            }))
          }
        }
      }
    } catch (e) {
      console.error('[whatsapp/send] delivery check failed:', e)
    }

    return NextResponse.json({ ok: true, message: inserted, reminderCleared, delivered })
  } catch (e) {
    console.error('[whatsapp/send] error:', e)
    return NextResponse.json({ error: 'שגיאה בשליחה' }, { status: 500 })
  }
}
