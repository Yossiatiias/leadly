import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'חסר מזהה עובד' }, { status: 400 })

    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', id).single()

    // לא מוחקים תורים/לידים שהיו משויכים לעובד — רק מבטלים את השיוך, כדי
    // שההיסטוריה תישאר. אם המחיקה עצמה תיכשל בגלל FK כלשהו, זה ייתפס למטה
    await supabase.from('appointments').update({ assigned_to: null }).eq('assigned_to', id)
    await supabase.from('leads').update({ assigned_to: null }).eq('assigned_to', id)

    // מנקים את העובד מהגדרות העסק (שעות/תחומי אחריות/קוד אופטימה) — אחרת
    // המזהה שלו נשאר "יתום" ב-businesses.settings וממשיך להיות מוזרק
    // לפרומפט של הבוט (profileMap[uid] || uid מציג UUID גולמי ללקוח)
    if (profile?.business_id) {
      const { data: biz } = await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
      const s = biz?.settings || {}
      const employee_schedules = { ...(s.employee_schedules || {}) }
      const employee_responsibilities = { ...(s.employee_responsibilities || {}) }
      const optima_doctor_codes = { ...(s.optima_doctor_codes || {}) }
      delete employee_schedules[id]
      delete employee_responsibilities[id]
      delete optima_doctor_codes[id]
      await supabase.from('businesses').update({
        settings: { ...s, employee_schedules, employee_responsibilities, optima_doctor_codes },
      }).eq('id', profile.business_id)
    }

    // מוחק את משתמש ה-auth — אצל Supabase profiles.id בד"כ FK עם ON DELETE
    // CASCADE ל-auth.users, כך שזה מוחק גם את שורת ה-profile. מחיקה ישירה
    // נוספת של ה-profile כרשת ביטחון, לא מזיקה אם כבר נמחקה
    const { error: authErr } = await supabase.auth.admin.deleteUser(id)
    if (authErr) throw authErr
    await supabase.from('profiles').delete().eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('employee delete error:', err)
    return NextResponse.json({ error: err?.message || 'שגיאה במחיקה' }, { status: 500 })
  }
}
