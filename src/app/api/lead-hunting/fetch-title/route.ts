import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ title: null })

  try {
    const fullUrl = url.startsWith('http') ? url : 'https://' + url
    const u = new URL(fullUrl)

    // Facebook — extract from slug if not numeric
    if (u.hostname.includes('facebook.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0] === 'groups' && parts[1] && !/^\d+$/.test(parts[1])) {
        const name = decodeURIComponent(parts[1]).replace(/[-_]/g, ' ')
        return NextResponse.json({ title: name })
      }
      return NextResponse.json({ title: null })
    }

    // Instagram — extract username from URL
    if (u.hostname.includes('instagram.com')) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts[0]) {
        const username = parts[0].replace(/^@/, '')
        return NextResponse.json({ title: '@' + username })
      }
      return NextResponse.json({ title: null })
    }

    // Website — fetch and extract <title>
    const res = await fetch(fullUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Leadly/1.0)' },
      signal: AbortSignal.timeout(5000),
    })
    const html = await res.text()
    const match = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)
    if (!match) return NextResponse.json({ title: null })
    const raw = match[1].trim()
    // Clean up common suffixes like "Home | My Site" or "My Site - Home"
    const clean = raw.split(/\s*[\|–—-]\s*/)[0].trim()
    return NextResponse.json({ title: clean || null })
  } catch {
    return NextResponse.json({ title: null })
  }
}
