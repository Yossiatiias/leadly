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

    // טען את כל פריטי הידע הפעילים
    const { data: items } = await supabase
      .from('qa_knowledge')
      .select('type, title, question, answer, content, source_url, file_url')
      .eq('business_id', business_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (!items || items.length === 0) {
      return NextResponse.json({ answer: 'אין מידע במאגר הידע עדיין. הוסף שאלות, קבצים או לינקים.' })
    }

    // בנה context מכל הפריטים
    const knowledgeContext = items.map(item => {
      if (item.type === 'qa') return `ש: ${item.question}\nת: ${item.answer}`
      if (item.type === 'url') return `[מאתר ${item.source_url}]:\n${item.content || item.answer}`
      if (item.type === 'file') return `[מקובץ "${item.title}"]:\n${item.content || item.answer}`
      return `${item.title}: ${item.answer}`
    }).join('\n\n---\n\n')

    const systemPrompt = `אתה עוזר פנימי חכם של מערכת Leadly.
המשתמש הוא נציג מכירות שרוצה מידע על העסק.
ענה בעברית, קצר ומדויק, בהתבסס אך ורק על המידע שלפניך.
אם התשובה לא נמצאת במידע — אמור בכנות "לא מצאתי מידע על כך במאגר".

מאגר הידע הארגוני:
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
        max_tokens: 600,
        temperature: 0.3,
      }),
    })

    if (!res.ok) throw new Error(`Groq error: ${res.status}`)
    const data = await res.json()
    const answer = data.choices?.[0]?.message?.content || 'לא הצלחתי לענות'

    return NextResponse.json({ answer })
  } catch (err) {
    console.error('knowledge chat error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
