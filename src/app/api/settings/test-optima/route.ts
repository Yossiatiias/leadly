import { NextRequest, NextResponse } from 'next/server'
import { toOptimaConfig } from '@/lib/optima'

// בדיקת חיבור לאופטימה חייבת לרוץ בצד שרת, לא ישירות מהדפדפן — ל-API שלהם
// אין תמיכה ב-CORS (הם בנויים לתקשורת שרת-לשרת), אז קריאה ישירה מהדפדפן
// נכשלת עם שגיאת רשת גנרית גם כשהפרטים תקינים לגמרי
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const config = toOptimaConfig(body)
  if (!config) return NextResponse.json({ ok: false, message: 'חסרים פרטים' }, { status: 400 })

  try {
    const base = config.baseUrl.replace(/\/$/, '')
    const auth = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64')
    const res = await fetch(`${base}/doctors_sites?company=${encodeURIComponent(config.company)}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.doctors_sites) {
      return NextResponse.json({ ok: true, message: `✓ מחובר — נמצאו ${Object.keys(data.doctors_sites).length} קודי רופאים` })
    }
    return NextResponse.json({ ok: false, message: `שגיאה: ${data?.detail || `HTTP ${res.status}`}` })
  } catch (e) {
    return NextResponse.json({ ok: false, message: `שגיאת חיבור: ${e instanceof Error ? e.message : 'לא ידוע'}` })
  }
}
