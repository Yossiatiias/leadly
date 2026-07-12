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

    // סרוק את האתר עם headers שמתחזים לדפדפן אמיתי
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      if (res.status === 403) {
        return NextResponse.json({ error: 'האתר חוסם גישה אוטומטית (403). נסה להדביק את הטקסט ידנית דרך "שאלה ותשובה".' }, { status: 422 })
      }
      if (res.status === 404) {
        return NextResponse.json({ error: 'הכתובת לא נמצאה (404). בדוק שה-URL נכון.' }, { status: 422 })
      }
      throw new Error(`HTTP ${res.status}`)
    }

    const html = await res.text()

    // חילוץ טקסט מה-HTML (הסרת תגיות)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000) // מגבלת תוכן

    const { data, error } = await supabase
      .from('qa_knowledge')
      .insert({
        business_id,
        type:        'url',
        title:       title || url,
        question:    title || url,
        answer:      text,
        content:     text,
        source_url:  url,
        category,
        audience,
        is_active:   true,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, item: data, chars: text.length })
  } catch (err) {
    console.error('scrape error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
