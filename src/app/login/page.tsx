'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Mode = 'login' | 'forgot' | 'forgot-sent' | 'reset'

function BLIcon({ size = 36, white = false }: { size?: number; white?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      {white ? (
        <g transform="translate(10 10)">
          <path d="M151.058 79.234 A62 62 0 1 1 111.205 31.746 L103.681 52.412 A40 40 0 1 0 129.392 83.054 Z" fill="white" />
          <path d="M87 89C103 83 117 72 130 59" stroke="white" strokeWidth="11" strokeLinecap="round" />
          <path d="M120 46L145 43L137 67Z" fill="white" />
        </g>
      ) : (
        <>
          <defs>
            <linearGradient id="blicon_g" x1="22" y1="25" x2="151" y2="151" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0F67F5" />
              <stop offset="0.5" stopColor="#2356F4" />
              <stop offset="1" stopColor="#7C35E8" />
            </linearGradient>
          </defs>
          <g transform="translate(10 10)">
            <path d="M151.058 79.234 A62 62 0 1 1 111.205 31.746 L103.681 52.412 A40 40 0 1 0 129.392 83.054 Z" fill="url(#blicon_g)" />
            <path d="M87 89C103 83 117 72 130 59" stroke="#2356F4" strokeWidth="11" strokeLinecap="round" />
            <path d="M120 46L145 43L137 67Z" fill="#2356F4" />
          </g>
        </>
      )}
    </svg>
  )
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [processingInvite, setProcessingInvite] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Supabase sends recovery/invite links as #access_token=... (implicit flow)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const access_token = hashParams.get('access_token')
    const refresh_token = hashParams.get('refresh_token')
    const hashType = hashParams.get('type')

    if (access_token && refresh_token) {
      console.log('[BetterLead auth] hash token detected, type:', hashType)
      window.history.replaceState(null, '', window.location.pathname)

      if (hashType === 'recovery') {
        supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
          if (error) {
            console.error('[BetterLead auth] setSession error:', error.message)
            setError('הקישור פג תוקפו. בקש קישור איפוס חדש.')
            return
          }
          console.log('[BetterLead auth] recovery session set — showing reset form')
          setMode('reset')
        })
      } else {
        setProcessingInvite(true)
        supabase.auth.setSession({ access_token, refresh_token }).then(async ({ data: { session }, error }) => {
          if (error || !session) {
            console.error('[BetterLead auth] invite setSession error:', error?.message)
            setProcessingInvite(false)
            return
          }
          console.log('[BetterLead auth] invite session set for:', session.user.email)
          const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', session.user.id).single()
          const { data: biz } = profile?.business_id
            ? await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
            : { data: null }
          window.location.replace(!biz?.settings?.onboarding_completed ? '/onboarding' : '/')
        })
      }
      return
    }

    // PKCE fallback: for ?code= in query params (future-proof)
    const searchParams = new URLSearchParams(window.location.search)
    const codeInUrl = searchParams.has('code')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[BetterLead auth] event:', event, session?.user?.email ?? 'no session')
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset')
        window.history.replaceState(null, '', window.location.pathname)
        return
      }
      if (event === 'SIGNED_IN' && session && codeInUrl) {
        setProcessingInvite(true)
        const { data: profile } = await supabase
          .from('profiles').select('business_id').eq('id', session.user.id).single()
        const { data: biz } = profile?.business_id
          ? await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
          : { data: null }
        window.location.replace(!biz?.settings?.onboarding_completed ? '/onboarding' : '/')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError('אימייל או סיסמה שגויים'); setLoading(false) }
    else { router.push('/'); router.refresh() }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://betterlead.vercel.app/login',
    })
    setLoading(false)
    if (error) setError('שגיאה בשליחת המייל. בדוק את הכתובת ונסה שוב.')
    else setMode('forgot-sent')
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) { setError('הסיסמאות אינן תואמות'); return }
    if (newPassword.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (error) {
      if (error.message.includes('different from the old password'))
        setError('הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית.')
      else
        setError('שגיאה באיפוס הסיסמה. נסה שוב.')
    } else { router.push('/'); router.refresh() }
  }

  if (processingInvite) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, background: '#060D1F' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <BLIcon size={48} white />
        <div style={{ width: 28, height: 28, border: '3px solid #0F67F5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: 0 }}>מאמת את החשבון שלך...</p>
      </div>
    )
  }

  const heading = mode === 'forgot' ? 'שכחת סיסמה?' : mode === 'forgot-sent' ? 'מייל נשלח!' : mode === 'reset' ? 'הגדר סיסמה חדשה' : 'ברוך הבא'
  const subtitle = mode === 'forgot' ? 'נשלח קישור לאיפוס לכתובת המייל שלך'
    : mode === 'forgot-sent' ? `שלחנו קישור לאיפוס סיסמה אל ${email}`
    : mode === 'reset' ? 'בחר סיסמה חדשה לחשבון שלך'
    : 'התחבר כדי לנהל את הלידים שלך'

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        .bl-brand { display: none !important }
        @media (min-width: 900px) { .bl-brand { display: flex !important } .bl-mobile-logo { display: none !important } }
        .bl-input { transition: border-color 0.15s, box-shadow 0.15s, background 0.15s }
        .bl-input:focus { border-color: #0F67F5 !important; box-shadow: 0 0 0 3px rgba(15,103,245,0.14) !important; background: #fff !important; outline: none }
        .bl-btn { transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s }
        .bl-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 6px 28px rgba(15,103,245,0.45) !important }
        .bl-btn:active:not(:disabled) { transform: translateY(0) }
        .bl-form-wrap { animation: fadeUp 0.35s ease both }
        .bl-link { color: #0F67F5; font-size: 13px; font-weight: 600; background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; text-decoration: none }
        .bl-link:hover { text-decoration: underline }
      `}</style>

      <div style={{ minHeight: '100vh', display: 'flex' }}>

        {/* ── Brand Panel ── */}
        <div className="bl-brand" style={{
          width: '54%', flexDirection: 'column', justifyContent: 'space-between',
          padding: '52px 60px', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(150deg, #060D1F 0%, #0C1845 50%, #18063A 100%)',
        }}>
          <div style={{ position: 'absolute', top: '22%', left: '25%', width: 480, height: 480, background: 'radial-gradient(ellipse, rgba(15,103,245,0.13) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: '10%', right: '5%', width: 320, height: 320, background: 'radial-gradient(ellipse, rgba(124,53,232,0.11) 0%, transparent 65%)', borderRadius: '50%', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, opacity: 0.035, backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 0)', backgroundSize: '30px 30px', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 11 }}>
            <BLIcon size={38} white />
            <span style={{ fontSize: 21, fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>BetterLead</span>
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#3B82F6', marginBottom: 18 }}>AI Lead Management</p>
            <h1 style={{ fontSize: 44, fontWeight: 900, color: 'white', lineHeight: 1.13, letterSpacing: '-0.03em', margin: '0 0 18px' }}>
              ניהול לידים<br />
              <span style={{ background: 'linear-gradient(90deg, #3B82F6 0%, #8B5CF6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>חכם ואפקטיבי.</span>
            </h1>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.75, maxWidth: 320, margin: '0 0 44px' }}>
              בוט AI שמנהל שיחות וואטסאפ, עוקב אחרי לידים ומגדיל הכנסות — אוטומטית, 24/7.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {['תגובה אוטומטית ללידים בוואטסאפ', 'דשבורד מכירות בזמן אמת', 'אונבורדינג פשוט — מוכן תוך דקות'].map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.6)' }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ position: 'relative', zIndex: 1, fontSize: 11.5, color: 'rgba(255,255,255,0.2)', margin: 0 }}>© BetterLead 2026</p>
        </div>

        {/* ── Form Panel ── */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 28px', background: '#F7F9FC' }}>
          <div key={mode} className="bl-form-wrap" style={{ width: '100%', maxWidth: 400 }}>

            <div className="bl-mobile-logo" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 40 }}>
              <BLIcon size={34} />
              <span style={{ fontSize: 20, fontWeight: 800, background: 'linear-gradient(90deg, #0F67F5, #7C35E8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>BetterLead</span>
            </div>

            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: '0 0 6px' }}>{heading}</h2>
              <p style={{ fontSize: 14.5, color: '#64748B', margin: 0 }}>{subtitle}</p>
            </div>

            {/* ── Login form ── */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="your@email.com" dir="ltr" className="bl-input"
                    style={{ width: '100%', padding: '12px 15px', border: '1.5px solid #E2E8F0', borderRadius: 11, fontSize: 14, color: '#0F172A', background: '#F7F9FC', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>סיסמה</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" dir="ltr" className="bl-input"
                    style={{ width: '100%', padding: '12px 15px', border: '1.5px solid #E2E8F0', borderRadius: 11, fontSize: 14, color: '#0F172A', background: '#F7F9FC', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  <div style={{ textAlign: 'center', marginTop: 10 }}>
                    <button type="button" className="bl-link" onClick={() => { setMode('forgot'); setError('') }}>שכחתי סיסמה</button>
                  </div>
                </div>
                {error && <div style={{ background: '#FFF1F2', color: '#E11D48', fontSize: 13, padding: '10px 14px', borderRadius: 9, border: '1px solid #FECDD3', fontWeight: 500 }}>{error}</div>}
                <button type="submit" disabled={loading} className="bl-btn"
                  style={{ width: '100%', padding: '13px', background: loading ? '#CBD5E1' : 'linear-gradient(135deg, #0F67F5 0%, #7C35E8 100%)', color: 'white', fontWeight: 700, fontSize: 15, borderRadius: 11, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginTop: 6, boxShadow: loading ? 'none' : '0 4px 18px rgba(15,103,245,0.32)' }}>
                  {loading ? <Spinner /> : 'כניסה למערכת'}
                </button>
              </form>
            )}

            {/* ── Forgot password form ── */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימייל</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="your@email.com" dir="ltr" className="bl-input"
                    style={{ width: '100%', padding: '12px 15px', border: '1.5px solid #E2E8F0', borderRadius: 11, fontSize: 14, color: '#0F172A', background: '#F7F9FC', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                {error && <div style={{ background: '#FFF1F2', color: '#E11D48', fontSize: 13, padding: '10px 14px', borderRadius: 9, border: '1px solid #FECDD3', fontWeight: 500 }}>{error}</div>}
                <button type="submit" disabled={loading} className="bl-btn"
                  style={{ width: '100%', padding: '13px', background: loading ? '#CBD5E1' : 'linear-gradient(135deg, #0F67F5 0%, #7C35E8 100%)', color: 'white', fontWeight: 700, fontSize: 15, borderRadius: 11, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: loading ? 'none' : '0 4px 18px rgba(15,103,245,0.32)' }}>
                  {loading ? <Spinner /> : 'שלח קישור לאיפוס'}
                </button>
                <button type="button" className="bl-link" style={{ textAlign: 'center', color: '#64748B', fontWeight: 500 }} onClick={() => { setMode('login'); setError('') }}>
                  ← חזור להתחברות
                </button>
              </form>
            )}

            {/* ── Forgot sent confirmation ── */}
            {mode === 'forgot-sent' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '18px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="10" cy="10" r="10" fill="#22C55E" />
                    <path d="M6 10L8.5 12.5L14 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#15803D', margin: '0 0 4px' }}>מייל נשלח בהצלחה</p>
                    <p style={{ fontSize: 13, color: '#166534', margin: 0, lineHeight: 1.6 }}>בדוק את תיבת הדואר שלך ולחץ על הקישור לאיפוס הסיסמה.</p>
                  </div>
                </div>
                <button type="button" className="bl-link" style={{ textAlign: 'center', color: '#64748B', fontWeight: 500 }} onClick={() => { setMode('login'); setError('') }}>
                  ← חזור להתחברות
                </button>
              </div>
            )}

            {/* ── Reset password form ── */}
            {mode === 'reset' && (
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>סיסמה חדשה</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="לפחות 6 תווים" dir="ltr" className="bl-input"
                    style={{ width: '100%', padding: '12px 15px', border: '1.5px solid #E2E8F0', borderRadius: 11, fontSize: 14, color: '#0F172A', background: '#F7F9FC', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 6 }}>אימות סיסמה</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required placeholder="••••••••" dir="ltr" className="bl-input"
                    style={{ width: '100%', padding: '12px 15px', border: '1.5px solid #E2E8F0', borderRadius: 11, fontSize: 14, color: '#0F172A', background: '#F7F9FC', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                {error && <div style={{ background: '#FFF1F2', color: '#E11D48', fontSize: 13, padding: '10px 14px', borderRadius: 9, border: '1px solid #FECDD3', fontWeight: 500 }}>{error}</div>}
                <button type="submit" disabled={loading} className="bl-btn"
                  style={{ width: '100%', padding: '13px', background: loading ? '#CBD5E1' : 'linear-gradient(135deg, #0F67F5 0%, #7C35E8 100%)', color: 'white', fontWeight: 700, fontSize: 15, borderRadius: 11, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: loading ? 'none' : '0 4px 18px rgba(15,103,245,0.32)' }}>
                  {loading ? <Spinner /> : 'שמור סיסמה חדשה'}
                </button>
              </form>
            )}

            <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 28 }}>
              BetterLead © 2026 — AI Lead Management
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function Spinner() {
  return (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
      טוען...
    </span>
  )
}
