'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('אימייל או סיסמה שגויים')
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-canvas)' }}>
      {/* Left panel - branding */}
      <div style={{
        display: 'none',
        width: '45%',
        background: 'linear-gradient(160deg, #226F94 0%, #3FA9DC 60%, #8DCB3F 100%)',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden',
      }} className="lg-panel">
        <style>{`@media(min-width:1024px){.lg-panel{display:flex!important}}`}</style>

        {/* Pattern */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.07,
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '36px 36px',
        }} />

        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', width: '100%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="Leadly" style={{ height: '56px', width: 'auto', objectFit: 'contain', marginBottom: '24px' }} />
          <h2 style={{ fontSize: '28px', fontWeight: 800, color: 'white', marginBottom: '10px' }}>Leadly</h2>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '15px', maxWidth: '260px', margin: '0 auto 40px' }}>
            מערכת ניהול לידים חכמה מבוססת AI לעסקים
          </p>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxWidth: '300px', margin: '0 auto' }}>
            {[
              { n: 'AI', l: 'סקריפטים חכמים' },
              { n: '100%', l: 'מעקב לידים' },
              { n: 'Live', l: 'דוחות בזמן אמת' },
              { n: '∞', l: 'פוטנציאל גדילה' },
            ].map(({ n, l }) => (
              <div key={l} style={{
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(10px)',
                borderRadius: '14px',
                padding: '16px',
                border: '1px solid rgba(255,255,255,0.2)',
                textAlign: 'right',
              }}>
                <p style={{ fontSize: '22px', fontWeight: 800, color: 'white' }}>{n}</p>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginTop: '3px' }}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          {/* Mobile logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-light.png" alt="Leadly" style={{ height: '48px', width: 'auto', objectFit: 'contain' }} />
          </div>

          <div style={{
            background: 'var(--bg-surface)',
            borderRadius: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 4px 24px rgba(30,41,59,0.08)',
            padding: '36px',
          }}>
            <div style={{ marginBottom: '28px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--fg-1)' }}>ברוך הבא</h1>
              <p style={{ fontSize: '14px', color: 'var(--fg-3)', marginTop: '4px' }}>התחבר כדי לנהל את הלידים שלך</p>
            </div>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--fg-2)', marginBottom: '6px' }}>אימייל</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                  dir="ltr"
                  style={{
                    width: '100%', padding: '11px 14px',
                    border: '1.5px solid var(--border-default)', borderRadius: '10px',
                    fontSize: '14px', color: 'var(--fg-1)', background: 'var(--bg-sunken)',
                    outline: 'none', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#3FA9DC'; e.target.style.boxShadow = '0 0 0 3px rgba(63,169,220,0.15)'; e.target.style.background = 'var(--bg-surface)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'var(--bg-sunken)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--fg-2)', marginBottom: '6px' }}>סיסמה</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  dir="ltr"
                  style={{
                    width: '100%', padding: '11px 14px',
                    border: '1.5px solid var(--border-default)', borderRadius: '10px',
                    fontSize: '14px', color: 'var(--fg-1)', background: 'var(--bg-sunken)',
                    outline: 'none', fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#3FA9DC'; e.target.style.boxShadow = '0 0 0 3px rgba(63,169,220,0.15)'; e.target.style.background = 'var(--bg-surface)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'var(--bg-sunken)' }}
                />
              </div>

              {error && (
                <div style={{ background: '#FEF2F2', color: '#DC2626', fontSize: '13px', padding: '10px 14px', borderRadius: '10px', border: '1px solid #FECACA' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '12px',
                  background: loading ? '#B5BDC8' : 'linear-gradient(135deg, #226F94, #3FA9DC)',
                  color: 'white', fontWeight: 700, fontSize: '15px',
                  borderRadius: '10px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', marginTop: '4px',
                  boxShadow: loading ? 'none' : '0 2px 10px rgba(37,109,133,0.3)',
                  transition: 'all 0.15s',
                }}
              >
                {loading ? 'מתחבר...' : 'כניסה למערכת'}
              </button>
            </form>
          </div>

          <p style={{ textAlign: 'center', fontSize: '12px', color: '#94A3B8', marginTop: '20px' }}>
            Leadly © 2026 — AI Lead Management
          </p>
        </div>
      </div>
    </div>
  )
}
