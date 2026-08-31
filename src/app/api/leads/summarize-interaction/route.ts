import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { lead_id, text, at } = await req.json()
    if (!lead_id || !text) return NextResponse.json({ error: 'חסר lead_id או text' }, { status: 400 })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'סכם את האינטראקציה הבאה עם לקוח במשפט עברי אחד קצר וברור (עד 15 מילים). בלי מרכאות, בלי הקדמות, רק המשפט עצמו.' },
          { role: 'user', content: String(text).slice(0, 2000) },
        ],
        max_tokens: 60,
        temperature: 0.3,
      }),
    })
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)

    const data = await res.json()
    const summary = (data.choices?.[0]?.message?.content || '').trim()
    if (!summary) return NextResponse.json({ error: 'לא התקבל סיכום' }, { status: 500 })

    await supabase.from('leads').update({
      last_interaction_summary: summary,
      last_interaction_summarized_at: at || new Date().toISOString(),
    }).eq('id', lead_id)

    return NextResponse.json({ summary })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
