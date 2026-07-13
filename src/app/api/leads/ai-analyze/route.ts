import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json()
    if (!lead_id) return NextResponse.json({ error: 'חסר lead_id' }, { status: 400 })

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (leadErr || !lead) return NextResponse.json({ error: 'ליד לא נמצא' }, { status: 404 })

    // Fetch conversation messages by phone + business
    let conversationText = ''
    if (lead.phone) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_phone', lead.phone)
        .eq('business_id', lead.business_id)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (convs?.length) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('direction, content')
          .eq('conversation_id', convs[0].id)
          .order('created_at', { ascending: true })
          .limit(30)

        if (msgs?.length) {
          conversationText = msgs
            .map(m => `${m.direction === 'inbound' ? 'לקוח' : 'נציג'}: ${m.content}`)
            .join('\n')
        }
      }
    }

    const TREATMENT_HE: Record<string, string> = {
      implant: 'השתלות', restorative: 'טיפול משמר', veneers: 'ציפויים',
      whitening: 'הלבנה', orthodontics: 'יישור שיניים', checkup: 'בדיקה', other: 'אחר',
    }

    const context = [
      lead.first_name || lead.name ? `שם: ${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name}` : null,
      lead.treatment_type ? `טיפול מבוקש: ${TREATMENT_HE[lead.treatment_type] || lead.treatment_type}` : null,
      lead.notes ? `הערות: ${lead.notes}` : null,
      `סטטוס נוכחי: ${lead.status}`,
      conversationText ? `\nשיחה:\n${conversationText}` : null,
    ].filter(Boolean).join('\n')

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `אתה מומחה מכירות בישראל. קרא את נתוני הליד והחזר JSON בלבד בפורמט:
{"summary":"סיכום קצר של הצורך והמצב (משפט אחד)","recommendation":"המלצת פעולה ספציפית ואחת ברורה"}
חשוב: עברית בלבד, ללא הסברים נוספים.`,
          },
          { role: 'user', content: context },
        ],
        max_tokens: 250,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    })

    if (!groqRes.ok) throw new Error(`Groq error ${groqRes.status}: ${await groqRes.text()}`)

    const groqData = await groqRes.json()
    const parsed = JSON.parse(groqData.choices[0].message.content)

    await supabase.from('leads').update({
      ai_summary: parsed.summary || null,
      ai_recommendation: parsed.recommendation || null,
    }).eq('id', lead_id)

    return NextResponse.json({ summary: parsed.summary, recommendation: parsed.recommendation })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
