import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl, cleanInstanceId } from '@/lib/greenApi'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// תרגום מצב Green API לשם ומשמעות בעברית — לתצוגה בפאנל הניהול בלבד
const STATE_META: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  authorized:    { label: 'מחובר ותקין',              tone: 'good' },
  yellowCard:    { label: 'כרטיס צהוב — הגבלת איכות', tone: 'warn' },
  blocked:       { label: 'חסום',                      tone: 'bad'  },
  notAuthorized: { label: 'מנותק — צריך סריקת QR',     tone: 'bad'  },
  sleepMode:     { label: 'הטלפון מנותק מהאינטרנט',    tone: 'bad'  },
  starting:      { label: 'מתאתחל',                    tone: 'warn' },
}

interface ConnHealth {
  business_id: string
  business_name: string
  connected: boolean
  bot_enabled: boolean
  state: string | null
  stateLabel: string
  tone: 'good' | 'warn' | 'bad' | 'unknown'
  queueSize: number | null
  last_message_at: string | null
  checkError: string | null
}

async function checkOne(businessId: string, businessName: string, conn: {
  instance_id: string; api_url: string; api_token: string; bot_enabled: boolean; last_message_at: string | null
}): Promise<ConnHealth> {
  const base: ConnHealth = {
    business_id: businessId,
    business_name: businessName,
    connected: true,
    bot_enabled: conn.bot_enabled,
    state: null,
    stateLabel: 'לא נבדק',
    tone: 'unknown',
    queueSize: null,
    last_message_at: conn.last_message_at,
    checkError: null,
  }

  try {
    const stateRes = await fetch(
      greenApiUrl(conn.api_url, conn.instance_id, 'getStateInstance', conn.api_token),
      { signal: AbortSignal.timeout(8000) }
    )
    if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`)
    const stateJson = await stateRes.json()
    const state: string | null = stateJson?.stateInstance || null
    base.state = state
    const meta = state ? STATE_META[state] : null
    base.stateLabel = meta?.label || state || 'לא ידוע'
    base.tone = meta?.tone || 'unknown'
  } catch (e) {
    base.checkError = e instanceof Error ? e.message : 'שגיאה בבדיקת מצב'
    base.tone = 'bad'
    base.stateLabel = 'שגיאה בבדיקה'
    return base // בלי state תקין אין טעם לבדוק תור
  }

  try {
    const cleanId = cleanInstanceId(conn.instance_id)
    const qRes = await fetch(
      greenApiUrl(conn.api_url, cleanId, 'showMessagesQueue', conn.api_token),
      { signal: AbortSignal.timeout(8000) }
    )
    if (qRes.ok) {
      const q = await qRes.json()
      base.queueSize = Array.isArray(q) ? q.length : null
      if (base.queueSize && base.queueSize > 0 && base.tone === 'good') {
        base.tone = 'warn' // תור לא ריק — עדות אמיתית לבעיה גם אם המצב תקין
      }
    }
  } catch { /* לא קריטי — נשאיר queueSize null */ }

  return base
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: callerProfile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'superadmin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: businesses } = await adminSupabase
    .from('businesses')
    .select('id, name')
    .order('name', { ascending: true })

  const businessIds = (businesses || []).map(b => b.id)
  const { data: connections } = await adminSupabase
    .from('whatsapp_connections')
    .select('business_id, instance_id, api_url, api_token, bot_enabled, last_message_at')
    .in('business_id', businessIds.length ? businessIds : [''])

  const results = await Promise.all(
    (businesses || []).map(async b => {
      const conn = (connections || []).find(c => c.business_id === b.id)
      if (!conn?.instance_id || !conn.api_token) {
        return {
          business_id: b.id, business_name: b.name, connected: false,
          bot_enabled: false, state: null, stateLabel: 'לא מחובר',
          tone: 'unknown' as const, queueSize: null, last_message_at: null, checkError: null,
        }
      }
      return checkOne(b.id, b.name, conn)
    })
  )

  return NextResponse.json({ connections: results, checked_at: new Date().toISOString() })
}
