import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { url, business_id, title } = await req.json()

    if (!url || !business_id) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    // סרוק את האתר
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadlyBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

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
        category:    'לינקים',
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
