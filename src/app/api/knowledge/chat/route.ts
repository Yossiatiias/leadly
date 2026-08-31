import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { question, business_id, history = [] } = await req.json()

    if (!question || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    // 1. Business settings
    const { data: business } = await supabase
      .from('businesses')
      .select('name, settings')
      .eq('id', business_id)
      .single()

    // 2. Knowledge base (staff + both + null audience)
    const { data: items, error: dbError } = await supabase
      .from('qa_knowledge')
      .select('type, question, answer, source_url, file_url')
      .eq('business_id', business_id)
      .eq('is_active', true)
      .or('audience.eq.staff,audience.eq.both,audience.is.null')
      .order('created_at', { ascending: false })

    if (dbError) throw dbError

    // 3. Lead lookup — detect phone number in question
    let leadContext = ''
    const phoneMatch = question.match(/0\d[\d\-\s]{7,9}/)
    if (phoneMatch) {
      const cleanPhone = phoneMatch[0].replace(/[\s\-]/g, '')
      const { data: leads } = await supabase
        .from('leads')
        .select('name, phone, email, status, temperature, notes, company_name, source, next_followup, created_at')
        .eq('business_id', business_id)
        .ilike('phone', `%${cleanPhone}%`)
        .limit(3)

      if (leads?.length) {
        leadContext = '\n\n--- מידע על ליד שנמצא לפי מספר טלפון ---\n' +
          leads.map(l => [
            `שם: ${l.name}`,
            l.phone        && `טלפון: ${l.phone}`,
            l.company_name && `חברה: ${l.company_name}`,
            l.email        && `מייל: ${l.email}`,
            l.status       && `סטטוס: ${l.status}`,
            l.temperature  && `חום: ${l.temperature}`,
            l.source       && `מקור: ${l.source}`,
            l.next_followup && `תאריך followup: ${new Date(l.next_followup).toLocaleDateString('he-IL')}`,
            l.notes        && `הערות: ${l.notes}`,
          ].filter(Boolean).join(' | ')).join('\n')
      }
    }

    // 4. Today's appointments
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999)
    const { data: appointments } = await supabase
      .from('appointments')
      .select('patient_name, patient_phone, treatment_type, scheduled_at, duration_minutes, status, notes')
      .eq('business_id', business_id)
      .gte('scheduled_at', todayStart.toISOString())
      .lte('scheduled_at', todayEnd.toISOString())
      .order('scheduled_at')

    let appointmentsContext = ''
    if (appointments?.length) {
      appointmentsContext = '\n\n--- תורים להיום ---\n' +
        appointments.map((a: any) => {
          const time = new Date(a.scheduled_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          const treat = a.treatment_type ? ` · ${a.treatment_type}` : ''
          const phone = a.patient_phone ? ` (${a.patient_phone})` : ''
          const status = a.status === 'cancelled' ? ' [בוטל]' : a.status === 'no_show' ? ' [לא הגיע]' : ''
          return `${time} — ${a.patient_name}${phone}${treat}${status}${a.notes ? ' · ' + a.notes : ''}`
        }).join('\n')
    }

    // 5. Build business context from settings
    const s = business?.settings || {}

    // Employee responsibilities (service → doctor mapping)
    const empResponsibilities: Record<string, string[]> = s.employee_responsibilities || {}
    let staffContext = ''
    if (Object.keys(empResponsibilities).length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('business_id', business_id)
      const profileMap: Record<string, string> = {}
      for (const p of profiles || []) profileMap[p.id] = p.full_name || 'עובד'
      const staffLines = Object.entries(empResponsibilities)
        .filter(([, svcs]) => svcs.length > 0)
        .map(([uid, svcs]) => `${profileMap[uid] || uid}: ${svcs.join(', ')}`)
      if (staffLines.length > 0) {
        staffContext = '\n\n--- שיוך שירותים לאנשי צוות ---\n' + staffLines.join('\n') +
          '\n(הצע תורים רק עם הרופא/מטפל שמטפל בשירות המבוקש)'
      }
    }

    // Closed dates (holidays etc.)
    const exceptions: {date: string; reason: string}[] = s.business_exceptions || []
    let exceptionsContext = ''
    if (exceptions.length > 0) {
      const upcoming = exceptions
        .filter(e => e.date >= new Date().toISOString().slice(0, 10))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 10)
      if (upcoming.length > 0) {
        exceptionsContext = '\n\n--- תאריכים שהעסק סגור (אל תציע תורים בתאריכים אלו!) ---\n' +
          upcoming.map(e => `${e.date}${e.reason ? ' — ' + e.reason : ''}`).join('\n')
      }
    }

    // Services with notes
    const services: {name: string; price: string; duration: string; notes: string; active: boolean}[] = s.services || []
    const activeServices = services.filter(sv => sv.active && sv.name)
    let servicesContext = ''
    if (activeServices.length > 0) {
      servicesContext = '\n\n--- שירותים ומחירים ---\n' +
        activeServices.map(sv => {
          const parts = [sv.name]
          if (sv.notes) parts.push(`(${sv.notes})`)
          if (sv.price) parts.push(`₪${sv.price}`)
          if (sv.duration) parts.push(`${sv.duration} דקות`)
          return parts.join(' — ')
        }).join('\n')
    }

    const businessLines = [
      `שם העסק: ${business?.name || s.business_name || 'לא ידוע'}`,
      s.industry    && `תחום: ${s.industry}`,
      s.phone       && `טלפון עסקי: ${s.phone}`,
      s.goal        && `מטרת הבוט: ${s.goal}`,
      s.greeting    && `ברכת פתיחה ללקוח: ${s.greeting}`,
      s.bot_name    && `שם הבוט: ${s.bot_name}`,
    ].filter(Boolean).join('\n')

    // 6. Knowledge base context
    const knowledgeContext = items?.length
      ? items.map(item => {
          if (item.type === 'qa')   return `ש: ${item.question}\nת: ${item.answer}`
          if (item.type === 'url')  return `[מאתר ${item.source_url || item.question}]:\n${item.answer}`
          if (item.type === 'file') return `[מסמך: ${item.question}]:\n${item.answer}`
          return `${item.question}: ${item.answer}`
        }).join('\n\n---\n\n')
      : 'הספרייה הארגונית ריקה עדיין.'

    const systemPrompt = `אתה עוזר AI פנימי לנציגי המכירות. היום: ${today}.
תפקידך: לסייע לנציג בזמן אמת — כשלקוח שואל שאלה בשיחה, הנציג מקליד אותה כאן ואתה עונה מיד.

חוקים:
- ענה בעברית בלבד
- קצר וישיר — 2-4 שורות מקסימום
- אם יש תשובה ברורה — תן אותה ישירות
- אם אין מידע — אמור "לא מצאתי מידע על כך במאגר" (אל תמציא!)
- אם שאלה עמומה — בקש הבהרה בשנייה
- אל תציע תורים בתאריכים הסגורים!

--- פרטי העסק ---
${businessLines}

--- ספרייה ארגונית ---
${servicesContext}${knowledgeContext}${leadContext}${appointmentsContext}${exceptionsContext}${staffContext}`

    // 7. Build Groq messages with history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map((h: any) => ({
        role: h.role === 'bot' ? 'assistant' : 'user',
        content: h.text,
      })),
      { role: 'user', content: question },
    ]

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 500,
        temperature: 0.25,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq error ${res.status}: ${errText}`)
    }
    const groqData = await res.json()
    const answer = groqData.choices?.[0]?.message?.content || 'לא הצלחתי לענות'

    return NextResponse.json({ answer })
  } catch (err: any) {
    console.error('knowledge chat error:', err)
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
