import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { question, business_id } = await req.json()

    if (!question || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const { data: items, error: dbError } = await supabase
      .from('qa_knowledge')
      .select('type, question, answer, source_url, file_url')
      .eq('business_id', business_id)
      .eq('is_active', true)
      .or('audience.eq.customer,audience.eq.both,audience.is.null')
      .order('created_at', { ascending: false })

    if (dbError) throw dbError

    if (!items || items.length === 0) {
      return NextResponse.json({ answer: 'אין מידע במאגר הידע עדיין.' })
    }

    const knowledgeContext = items.map(item => {
      if (item.type === 'qa')   return `ש: ${item.question}\nת: ${item.answer}`
      if (item.type === 'url')  return `[מאתר ${item.source_url || item.question}]:\n${item.answer}`
      if (item.type === 'file') return `[מסמך: ${item.question}]:\n${item.answer}`
      return `${item.question}: ${item.answer}`
    }).join('\n\n---\n\n')

    const systemPrompt = `אתה בוט שיחה שעונה ללקוחות.
ענה בעברית, חמה ומקצועית, בהתבסס אך ורק על המידע שלפניך.
אם התשובה לא נמצאת — אמור "אבדוק ואחזור אליך" בלבד.
אל תחשוף מידע פנימי (הנחות, שיקולים עסקיים, נהלים פנימיים).

מאגר הידע:
${knowledgeContext}`

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 500,
        temperature: 0.5,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Groq error ${res.status}: ${errText}`)
    }
    const data = await res.json()
    const answer = data.choices?.[0]?.message?.content || 'לא הצלחתי לענות'

    return NextResponse.json({ answer })
  } catch (err: any) {
    console.error('knowledge chat-customer error:', err)
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
