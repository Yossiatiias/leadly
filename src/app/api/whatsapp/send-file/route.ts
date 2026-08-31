import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl, cleanInstanceId } from '@/lib/greenApi'
import { clearDueReminderByConversation } from '@/lib/leadReminders'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// שליחת קובץ ידנית (נציג אנושי) דרך השרת — אותו מסלול מוכח כמו שליחת טקסט
// ב-/api/whatsapp/send. הקובץ עצמו כבר הועלה ל-Supabase Storage בצד הלקוח
// (bucket lead-files, אותו bucket שכבר משמש לקבצים נכנסים) — כאן רק שולחים
// את ה-URL הציבורי שלו ל-Green API ורושמים את ההודעה + הקובץ במסד.
export async function POST(req: NextRequest) {
  try {
    const { conversation_id, business_id, lead_id, file_url, file_name, file_type, file_size, caption } = await req.json()
    if (!conversation_id || !business_id || !lead_id || !file_url || !file_name) {
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

    // כתיבה ידנית מותרת רק כשהסוכן מושהה — אותה הגנה כמו בשליחת טקסט
    if (conv.bot_enabled) {
      return NextResponse.json(
        { error: 'הסוכן פעיל בשיחה זו — יש לעצור אותו לפני כתיבה ידנית' },
        { status: 409 }
      )
    }

    const { data: connRow } = await supabase
      .from('whatsapp_connections')
      .select('api_token, api_url, instance_id')
      .eq('business_id', business_id)
      .limit(1)
      .maybeSingle()

    const apiUrl        = connRow?.api_url
    const greenInstance = cleanInstanceId(connRow?.instance_id)
    const greenToken    = connRow?.api_token

    if (!apiUrl || !greenInstance || !greenToken) {
      return NextResponse.json({ error: 'חיבור WhatsApp לא מוגדר לעסק' }, { status: 400 })
    }

    const sendRes = await fetch(
      greenApiUrl(apiUrl, greenInstance, 'sendFileByUrl', greenToken),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: `${conv.contact_phone}@c.us`,
          urlFile: file_url,
          fileName: file_name,
          caption: (caption || '').trim() || undefined,
        }),
      }
    )

    if (!sendRes.ok) {
      const errText = await sendRes.text()
      console.error('[whatsapp/send-file] Green API failed:', sendRes.status, errText)
      return NextResponse.json({ error: `שליחה נכשלה (${sendRes.status})` }, { status: 502 })
    }

    let waMessageId: string | null = null
    try {
      const sendJson = await sendRes.json()
      waMessageId = sendJson?.idMessage || null
    } catch { /* אין מזהה — נמשיך בלעדיו */ }

    const { data: insertedMsg, error: insErr } = await supabase.from('messages').insert({
      conversation_id,
      business_id,
      direction: 'outbound',
      content: (caption || '').trim() || file_name,
      sender_type: 'human',
      whatsapp_message_id: waMessageId,
    }).select().single()

    if (insErr) console.error('[whatsapp/send-file] message insert failed:', insErr)

    let insertedFile = null
    if (insertedMsg) {
      const { data: fileRow, error: fileErr } = await supabase.from('lead_files').insert({
        lead_id,
        business_id,
        message_id: insertedMsg.id,
        file_name,
        file_url,
        file_size: file_size ?? null,
        file_type: file_type ?? null,
      }).select().single()
      if (fileErr) console.error('[whatsapp/send-file] file record insert failed:', fileErr)
      else insertedFile = fileRow
    }

    await supabase.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id)

    const reminderCleared = await clearDueReminderByConversation(supabase, conversation_id)

    return NextResponse.json({ ok: true, message: insertedMsg, file: insertedFile, reminderCleared })
  } catch (e) {
    console.error('[whatsapp/send-file] error:', e)
    return NextResponse.json({ error: 'שגיאה בשליחת הקובץ' }, { status: 500 })
  }
}
