import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import dns from 'dns/promises'
import net from 'net'

// חוסם SSRF: מונע מכתובת שהמשתמש מזין לגרום לשרת לפנות לרשת פנימית
// (127.0.0.1, כתובות פרטיות, metadata endpoint של ספקי ענן וכו')
function isPrivateOrLocalAddress(ip: string): boolean {
  const type = net.isIP(ip)
  if (type === 4) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    if (a === 127) return true // loopback
    if (a === 10) return true // private
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 169 && b === 254) return true // link-local (כולל cloud metadata: 169.254.169.254)
    if (a === 0) return true
    return false
  }
  if (type === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1') return true // loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
    if (lower.startsWith('fe80')) return true // link-local
    return false
  }
  return true // לא כתובת IP תקינה — לא סומכים
}

async function isSafeUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const hostname = u.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false

  try {
    const records = await dns.lookup(hostname, { all: true })
    if (records.length === 0) return false
    return records.every(r => !isPrivateOrLocalAddress(r.address))
  } catch {
    return false // כשל בפענוח DNS — לא סומכים
  }
}

export async function POST(req: NextRequest) {
  // דורש התחברות — הנתיב מבצע בקשות רשת מטעם השרת ואסור שיהיה פתוח לציבור
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json()
  if (!url || typeof url !== 'string') return NextResponse.json({ title: null })

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

    // Website — fetch and extract <title>. מאמתים שהכתובת לא מצביעה לרשת פנימית
    // לפני הבקשה, ושוב לאחר כל הפניה (redirect יכול לקפוץ ל-IP פנימי).
    if (!(await isSafeUrl(u))) return NextResponse.json({ title: null })

    let current = fullUrl
    let res: Response | null = null
    for (let redirects = 0; redirects < 5; redirects++) {
      res = await fetch(current, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Leadly/1.0)' },
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location')!, current)
        if (!(await isSafeUrl(next))) return NextResponse.json({ title: null })
        current = next.toString()
        continue
      }
      break
    }
    if (!res) return NextResponse.json({ title: null })

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
