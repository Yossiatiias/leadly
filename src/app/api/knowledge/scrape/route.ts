import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { url, business_id, title, audience = 'both', category = 'לינקים' } = await req.json()

    if (!url || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      if (res.status === 403) return NextResponse.json({ error: 'האתר חוסם גישה אוטומטית (403). הדבק את הטקסט ידנית דרך שאלה ותשובה.' }, { status: 422 })
      if (res.status === 404) return NextResponse.json({ error: 'הכתובת לא נמצאה (404). בדוק שה-URL נכון.' }, { status: 422 })
      throw new Error(`HTTP ${res.status}`)
    }

    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000)

    const { data, error } = await supabase
      .from('qa_knowledge')
      .insert({
        business_id,
        type:       'url',
        question:   title || url,
        answer:     text,
        source_url: url,
        category,
        audience,
        is_active:  true,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, item: data, chars: text.length })
  } catch (err: any) {
    console.error('scrape error:', err)
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
