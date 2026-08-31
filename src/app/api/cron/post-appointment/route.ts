import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { greenApiUrl } from '@/lib/greenApi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// זמן ריצה מקסימלי לפונקציה (שניות) — נדרש כדי לאפשר השהיות בין הודעות
export const maxDuration = 60

// ─── הגנה מפני "כרטיס צהוב" של WhatsApp ──────────────────────────────────────
// שליחת עשרות הודעות ברצף בשנייה אחת נראית לוואטסאפ כמו ספאם ומביאה להגבלת המספר.
// לכן: מכסה קטנה בכל הרצה + השהיה אנושית בין הודעה להודעה.
// אם נשארו הודעות — ההרצה מפעילה את עצמה שוב (chain) כדי לנקז את התור בהדרגה,
// במקום להתפוצץ בבת אחת. כך גם עסק עם 30 תורים ביום לא מסכן את המספר שלו.
const MAX_PER_RUN = 5
const MIN_GAP_MS = 6_000
const MAX_GAP_MS = 11_000
const MAX_CHAIN_DEPTH = 12 // תקרת ביטחון: עד 60 הודעות ביום

export async function GET(req: NextRequest) {
  // הגנה: בלי זה, כל מי שמנחש את הכתובת יכול להפעיל שליחת הודעות אמיתיות
  // למטופלים אמיתיים של כל עסק שהדליק followup — שוב ושוב
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const results: string[] = []
  let sentThisRun = 0
  const chainDepth = parseInt(req.nextUrl.searchParams.get('chain') || '0')

  try {
    // Get all businesses with followup enabled
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name, settings')

    if (!businesses?.length) return NextResponse.json({ done: true, results })

    for (const biz of businesses) {
      const s = biz.settings || {}
      if (!s.followup_enabled) continue

      const hoursDelay = parseInt(s.followup_hours || '2')
      const msgTemplate: string = s.followup_message || 'שלום {{name}}, תודה על הביקור!'

      // Get WhatsApp connection for this business
      const { data: conn } = await supabase
        .from('whatsapp_connections')
        .select('instance_id, api_token, api_url')
        .eq('business_id', biz.id)
        .eq('bot_enabled', true)
        .single()

      if (!conn?.instance_id || !conn?.api_token) continue

      const greenUrl = conn.api_url || 'https://7107.api.greenapi.com'

      // Find appointments that ended ~hoursDelay hours ago, arrived/completed, no followup sent yet
      const windowStart = new Date(now.getTime() - (hoursDelay + 0.5) * 3600_000)
      const windowEnd   = new Date(now.getTime() - hoursDelay * 3600_000)

      // Look back 7 days for any unprocessed followups where enough time has passed
      const cutoffDate = new Date(now.getTime() - 7 * 24 * 3600_000)

      const { data: appts } = await supabase
        .from('appointments')
        .select('id, patient_name, patient_phone, scheduled_at, duration_minutes')
        .eq('business_id', biz.id)
        .in('status', ['arrived', 'completed'])
        .is('followup_sent_at', null)
        .not('patient_phone', 'is', null)
        .gte('scheduled_at', cutoffDate.toISOString())

      if (!appts?.length) continue

      for (const appt of appts) {
        // מכסה להרצה — היתר ימשיך בהרצת ההמשך
        if (sentThisRun >= MAX_PER_RUN) break

        // Only send if enough hours have passed since appointment ended
        const endTime = new Date(new Date(appt.scheduled_at).getTime() + (appt.duration_minutes || 30) * 60_000)
        const hoursSinceEnd = (now.getTime() - endTime.getTime()) / 3600_000
        if (hoursSinceEnd < hoursDelay) continue

        // השהיה אנושית לפני כל הודעה (חוץ מהראשונה) — לא רצף מכונה
        if (sentThisRun > 0) {
          await new Promise(r => setTimeout(r, MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS))))
        }

        // Build message
        const msg = msgTemplate
          .replace(/\{\{name\}\}/g, appt.patient_name)
          .replace(/\{\{clinic\}\}/g, biz.name || 'הקליניקה')

        // Send WhatsApp via Green API
        const phone = appt.patient_phone!.replace(/\D/g, '')
        const chatId = phone.startsWith('972') ? `${phone}@c.us` : `972${phone.replace(/^0/, '')}@c.us`

        try {
          const sendRes = await fetch(
            greenApiUrl(greenUrl, conn.instance_id, 'sendMessage', conn.api_token),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId, message: msg }),
            }
          )

          if (sendRes.ok) {
            sentThisRun++
            await supabase
              .from('appointments')
              .update({ followup_sent_at: now.toISOString() })
              .eq('id', appt.id)
            results.push(`✓ ${appt.patient_name} (${biz.name})`)
          } else {
            const errText = await sendRes.text()
            console.error('[post-appointment] send failed:', sendRes.status, errText.slice(0, 200))
            results.push(`✗ ${appt.patient_name} — HTTP ${sendRes.status}`)
          }
        } catch {
          results.push(`✗ ${appt.patient_name} — שגיאת שליחה`)
        }
      }
    }

    // מילאנו את המכסה ויש כנראה עוד — המשך בהרצה נוספת אחרי הפוגה,
    // כדי שהתור יתנקז בהדרגה ולא ברצף אחד שנראה כמו ספאם
    let chained = false
    if (sentThisRun >= MAX_PER_RUN && chainDepth < MAX_CHAIN_DEPTH) {
      // ה-host מהבקשה קודם — NEXT_PUBLIC_APP_URL עלול להיות localhost גם בייצור
      const host = req.headers.get('host')
      const base = host ? `https://${host}` : process.env.NEXT_PUBLIC_APP_URL
      const chainUrl = `${base}/api/cron/post-appointment?chain=${chainDepth + 1}`
      // after() — לא fire-and-forget רגיל: Vercel עלול להרוג פונקציה ברגע
      // שהיא מחזירה תשובה, וקריאה בלי await/after לא הייתה מובטחת לרוץ בפועל.
      after(async () => {
        try {
          await fetch(chainUrl, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
        } catch (e) {
          console.error('[post-appointment] chain fetch failed:', e)
        }
      })
      chained = true
      results.push(`↻ ממשיך בהרצה ${chainDepth + 1}`)
    }

    return NextResponse.json({
      done: true, ran_at: now.toISOString(),
      sent: sentThisRun, chain_depth: chainDepth, chained, results,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
