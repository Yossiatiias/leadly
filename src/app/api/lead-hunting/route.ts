import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  let url: string
  try {
    const body = await req.json()
    url = body.url
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  // Sanitize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `הדף החזיר שגיאה ${res.status}` }, { status: 422 })
    }

    const html = await res.text()

    // Strip scripts + styles + tags, collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()

    // Extract Israeli phone numbers (various formats)
    const phoneRaw = text.match(/(?:\+972|972|0)[-\s.]?(?:[23489]\d[-\s.]?\d{3}[-\s.]?\d{4}|5[0-9][-\s.]?\d{3}[-\s.]?\d{4}|\d{8,9})/g) || []
    const phones = [...new Set(
      phoneRaw
        .map(p => p.replace(/[-\s.]/g, ''))
        .filter(p => p.length >= 9 && p.length <= 13)
    )].slice(0, 20)

    // Extract emails (filter out obvious non-contact emails)
    const emailRaw = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
    const emails = [...new Set(
      emailRaw.filter(e =>
        !e.includes('sentry') &&
        !e.includes('example') &&
        !e.includes('schema') &&
        !e.includes('w3.org') &&
        !e.includes('example.com')
      )
    )].slice(0, 20)

    // Merge into candidates
    const candidates: { phone?: string; email?: string }[] = []
    const maxLen = Math.max(phones.length, emails.length)
    for (let i = 0; i < maxLen && i < 20; i++) {
      if (phones[i] || emails[i]) {
        candidates.push({ phone: phones[i], email: emails[i] })
      }
    }

    return NextResponse.json({ candidates })
  } catch (err: any) {
    const msg = err?.name === 'TimeoutError' ? 'הדף לא הגיב בזמן סביר' : (err?.message || 'שגיאה בטעינת הדף')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
