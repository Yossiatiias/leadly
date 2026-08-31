import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl } from '@/lib/greenApi'
import { ingestIncomingMessages } from '@/lib/whatsappIngest'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── רשת ביטחון: תופסת הודעות שנפלו כי ה-webhook מעולם לא הופעל ────────────
// קרה בפועל: חיבור Green API של עסק "הושעה" (suspended) ברמת החשבון —
// לא בעיית סריקת QR. הלקוח שלח הודעה, Green API קיבל אותה בעצמו, אבל אף
// webhook לא נשלח אלינו כל עוד ההשעיה בתוקף — לא ידענו בכלל שהיא קיימת עד
// שהלקוח התלונן. הרצה אחת ביום (מגבלת תוכנית Vercel) לא תופסת מיידית,
// אבל עדיפה משמעותית על גילוי רק כשלקוח מתלונן.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
    `${req.headers.get('x-forwarded-proto')}://${req.headers.get('host')}`

  const results: { business: string; state: string | null; processed: number; error?: string }[] = []

  const { data: connections } = await supabase
    .from('whatsapp_connections')
    .select('business_id, instance_id, api_token, api_url, bot_enabled')
    .eq('bot_enabled', true)

  const businessIds = (connections || []).map(c => c.business_id)
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, name')
    .in('id', businessIds.length ? businessIds : [''])
  const nameById = new Map((businesses || []).map(b => [b.id, b.name as string]))

  for (const conn of connections || []) {
    const businessName = nameById.get(conn.business_id) || conn.business_id
    if (!conn.instance_id || !conn.api_token) continue

    try {
      // מצב אמיתי מול Green API — ומעדכנים את ה-DB כדי שהמסך "הגדרות" יציג
      // סטטוס נכון, לא "מחובר" תקוע שנשאר כך גם אחרי שהחיבור נופל בפועל
      const stateRes = await fetch(
        greenApiUrl(conn.api_url, conn.instance_id, 'getStateInstance', conn.api_token),
        { signal: AbortSignal.timeout(10000) }
      )
      const stateJson = stateRes.ok ? await stateRes.json() : null
      const state: string | null = stateJson?.stateInstance || null
      await supabase.from('whatsapp_connections')
        .update({ status: state === 'authorized' ? 'connected' : 'disconnected' })
        .eq('business_id', conn.business_id)

      // שאילת ההודעות הנכנסות האחרונות — בלי פרמטר minutes מקבלים חלון רחב
      // בהרבה (בפועל ראינו שזה תפס גם הודעה מ-14+ שעות קודם), מספיק לרשת
      // ביטחון שרצה פעם ביום
      const msgsRes = await fetch(
        greenApiUrl(conn.api_url, conn.instance_id, 'lastIncomingMessages', conn.api_token),
        { signal: AbortSignal.timeout(15000) }
      )
      if (!msgsRes.ok) {
        results.push({ business: businessName, state, processed: 0, error: `lastIncomingMessages HTTP ${msgsRes.status}` })
        continue
      }
      const incomingMsgs: unknown[] = await msgsRes.json()
      if (!Array.isArray(incomingMsgs) || incomingMsgs.length === 0) {
        results.push({ business: businessName, state, processed: 0 })
        continue
      }

      const { processed } = await ingestIncomingMessages(supabase, conn.business_id, incomingMsgs, baseUrl)
      if (processed > 0) {
        console.warn('[reconcile-messages] caught messages the webhook missed:', businessName, processed)
      }
      results.push({ business: businessName, state, processed })
    } catch (e) {
      results.push({ business: businessName, state: null, processed: 0, error: e instanceof Error ? e.message : 'unknown error' })
    }
  }

  return NextResponse.json({ done: true, ran_at: new Date().toISOString(), results })
}
