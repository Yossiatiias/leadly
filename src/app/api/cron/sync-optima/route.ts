import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchOptimaAppointments, normalizeOptimaPhone, parseOptimaDateTime, computeDurationMinutes, toOptimaConfig,
  type OptimaRawAppointment,
} from '@/lib/optima'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── שלב 2 של אינטגרציית אופטימה: רשת ביטחון יומית בכיוון ההפוך ────────────
// (אופטימה → אנחנו). אין webhook מהצד שלהם, אז זו הדרך היחידה לתפוס תורים
// שנקבעו/שונו ישירות באופטימה (למשל מזכירה שקבעה טלפונית) — בדיוק המקרה
// שראינו בפועל עם מנשה קצב. פעם ביום בלבד (מגבלת תוכנית Vercel), אבל עדיף
// משמעותית מגילוי רק כשלקוח מתלונן.
//
// שמרנית בכוונה: יוצרת תור אצלנו רק אם לא מצאה שום התאמה קיימת (לפי טלפון
// + זמן מדויק, או optima_appointment_id ששמרנו בעצמנו בשלב 1). לא מנסה
// לזהות עדכון/ביטול של תור קיים — זה דורש קישור אמין יותר בין המערכות
// ונשאר לשלב הבא אם יתברר שצריך

const DEFAULT_SYNC_DAYS = 60

function toDDMMYYYY(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: { business: string; found: number; created: number; error?: string }[] = []

  const { data: businesses } = await supabase.from('businesses').select('id, name, settings')

  for (const biz of businesses || []) {
    const s = biz.settings || {}
    const optimaConfig = toOptimaConfig(s.optima)
    if (!optimaConfig) continue

    const doctorCodes: Record<string, string> = s.optima_doctor_codes || {}
    // הפוך את המיפוי profileId→code למיפוי code→profileId, לשימוש כשמוצאים תור חדש מאופטימה
    const codeToProfile: Record<string, string> = {}
    for (const [profileId, code] of Object.entries(doctorCodes)) {
      if (code) codeToProfile[code] = profileId
    }

    const syncDays = parseInt(s.booking_window_days || '') || DEFAULT_SYNC_DAYS
    const start = toDDMMYYYY(new Date())
    const end = toDDMMYYYY(new Date(Date.now() + syncDays * 86400000))

    const fetched = await fetchOptimaAppointments(optimaConfig, start, end)
    if (!fetched.ok) {
      results.push({ business: biz.name, found: 0, created: 0, error: fetched.error })
      continue
    }

    // רק תורים אמיתיים עם מטופל אמיתי — AppointmentType=2 זה חסימת זמן פנימית
    // (הפסקה/עובד), לא תור שצריך לדעת עליו
    const realAppts = fetched.appointments.filter((a: OptimaRawAppointment) => a.AppointmentType === '1' && (a.CellPhone || a.CardID > 0))

    let created = 0
    for (const appt of realAppts) {
      const optimaId = String(appt.AppointmentID)

      // כבר מוכר לנו? (או ששלחנו אותו בעצמנו בשלב 1, או שכבר סונכרן בעבר)
      const { data: byOptimaId } = await supabase
        .from('appointments').select('id').eq('business_id', biz.id).eq('optima_appointment_id', optimaId).maybeSingle()
      if (byOptimaId) continue

      const phone = normalizeOptimaPhone(appt.CellPhone)
      const scheduledAtISO = parseOptimaDateTime(appt.AppointmentDate, appt.AppointmentStartTime)
      if (!phone || !scheduledAtISO) continue

      // גם בלי optima_appointment_id תואם — יכול להיות שזה בדיוק התור ששלחנו
      // בעצמנו בשלב 1 (אם התגובה מאופטימה לא כללה AppointmentID). התאמה לפי
      // טלפון+זמן מדויק מונעת כפילות במקרה הזה
      const { data: existing } = await supabase
        .from('appointments').select('id')
        .eq('business_id', biz.id).eq('patient_phone', phone).eq('scheduled_at', scheduledAtISO)
        .maybeSingle()
      if (existing) {
        // מוכר, רק שלא שמרנו לו optima_appointment_id — נשלים אותו כדי שהפעם
        // הבאה תזהה אותו ישירות בלי להסתמך על טלפון+זמן
        await supabase.from('appointments').update({ optima_appointment_id: optimaId }).eq('id', existing.id)
        continue
      }

      // סנכרון יומן בלבד — לא מאגר פונים. אם כבר יש ליד אמיתי לטלפון הזה
      // (הגיע דרך הבוט/פייסבוק/ידני) מקשרים את התור אליו לנוחות, אבל
      // **לעולם לא יוצרים ליד חדש** רק כי יש תור באופטימה. מי שלא פנה
      // אלינו בעצמו לא אמור להופיע במאגר הפונים — קרה בפועל שכל 27 מטופלי
      // אופטימה נכנסו כלידים "מזוהמים" לפני התיקון הזה, יוסי ביקש למנוע.
      // התור עצמו עדיין נשמר (patient_name/phone ישירות על השורה) — זה
      // מספיק כדי שהבוט יידע שהזמן תפוס ולא יכפיל הזמנה
      let leadId: string | null = null
      const { data: existingLead } = await supabase
        .from('leads').select('id').eq('business_id', biz.id).eq('phone', phone).is('deleted_at', null).maybeSingle()
      if (existingLead) leadId = existingLead.id

      const { error: insErr } = await supabase.from('appointments').insert({
        business_id: biz.id,
        lead_id: leadId,
        patient_name: appt.FullName?.trim() || phone,
        patient_phone: phone,
        treatment_type: appt.Subject || null,
        scheduled_at: scheduledAtISO,
        duration_minutes: computeDurationMinutes(appt.AppointmentStartTime, appt.AppointmentEndTime),
        status: 'scheduled',
        notes: 'סונכרן אוטומטית מאופטימה (נקבע ישירות אצלם, לא דרך הבוט)',
        assigned_to: codeToProfile[appt.DoctorCode] || null,
        optima_appointment_id: optimaId,
      })
      if (!insErr) created++
      else console.error('[sync-optima] appointment insert failed:', JSON.stringify(insErr))
    }

    if (created > 0) console.warn('[sync-optima] created appointments missing from BetterLead:', biz.name, created)
    results.push({ business: biz.name, found: realAppts.length, created })
  }

  return NextResponse.json({ done: true, ran_at: new Date().toISOString(), results })
}
