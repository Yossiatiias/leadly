import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl, cleanInstanceId } from '@/lib/greenApi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/* בדיקת מסירה בפועל של הודעות יוצאות.
   WhatsApp מאשר קבלה מיד, אבל ההודעה עשויה להיתקע בתור ולא להימסר ללקוח.
   הנתיב מחזיר רשימת הודעות שתקועות, כדי שהממשק יסמן אותן באדום. */
export async function POST(req: NextRequest) {
  try {
    const { conversation_id, business_id } = await req.json()
    if (!conversation_id || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const { data: connRow } = await supabase
      .from('whatsapp_connections')
      .select('api_token, api_url, instance_id')
      .eq('business_id', business_id)
      .limit(1)
      .maybeSingle()

    // ראה הערה זהה ב-send/route.ts — בכוונה בלי fallback למשתני סביבה גלובליים
    const apiUrl        = connRow?.api_url
    const greenInstance = cleanInstanceId(connRow?.instance_id)
    const greenToken    = connRow?.api_token
    if (!apiUrl || !greenInstance || !greenToken) {
      return NextResponse.json({ stuck: [], blocked: false })
    }

    // 1. תור ההודעות הממתינות — כל מה שכאן טרם נמסר
    let queue: { messageID?: string; body?: { message?: string; chatId?: string } }[] = []
    try {
      const qRes = await fetch(greenApiUrl(apiUrl, greenInstance, 'showMessagesQueue', greenToken))
      if (qRes.ok) {
        const j = await qRes.json()
        if (Array.isArray(j)) queue = j
      }
    } catch { /* ממשיכים בלי התור */ }

    // 2. מצב החיבור — כדי להסביר לנציג למה נתקע
    let state: string | null = null
    try {
      const sRes = await fetch(greenApiUrl(apiUrl, greenInstance, 'getStateInstance', greenToken))
      if (sRes.ok) state = (await sRes.json())?.stateInstance || null
    } catch { /* לא קריטי */ }

    // "blocked" (הבאנר האדום המפחיד) חייב עדות אמיתית שמשהו תקוע —
    // לא רק את דגל האיכות של WhatsApp. yellowCard יכול להישאר תלוי גם
    // כשהודעות בפועל יוצאות ונכנסות כרגיל (ראינו את זה במקרה אמיתי:
    // תור ריק + תשובה התקבלה בפועל, אבל state עדיין yellowCard).
    // qualityWarning מייצג את הדגל עצמו — לאזהרה עדינה, לא לטענה שגויה.
    const qualityWarning = state === 'yellowCard'
    const accountBlocked = state === 'blocked'

    if (queue.length === 0) {
      return NextResponse.json({ stuck: [], stuckIds: [], state, blocked: accountBlocked, qualityWarning })
    }

    // 3. התאמה מול ההודעות היוצאות שלנו בשיחה (24 שעות אחרונות)
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, content, whatsapp_message_id')
      .eq('conversation_id', conversation_id)
      .eq('direction', 'outbound')
      .gte('created_at', since)

    const queueIds  = new Set(queue.map(q => q.messageID).filter(Boolean))
    const queueText = new Set(queue.map(q => (q.body?.message || '').trim()).filter(Boolean))

    const stuck = (msgs || [])
      .filter(m =>
        (m.whatsapp_message_id && queueIds.has(m.whatsapp_message_id)) ||
        queueText.has((m.content || '').trim())
      )
      .map(m => m.id)

    // בענף הזה יש בפועל הודעות תקועות בתור (queue.length > 0) — זו עדות אמיתית
    // לבעיה, לא רק דגל. blocked=true כאן מוצדק גם אם המצב עדיין yellowCard
    return NextResponse.json({
      stuck, stuckIds: stuck, state,
      blocked: true,
      qualityWarning,
      queueSize: queue.length,
    })
  } catch (e) {
    console.error('[delivery-status] error:', e)
    return NextResponse.json({ stuck: [], stuckIds: [], blocked: false })
  }
}
