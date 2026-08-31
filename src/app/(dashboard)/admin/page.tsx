'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, Plus, CheckCircle2, WifiOff, Wifi, X, Loader2, Building2, Mail, User, RefreshCw, Activity } from 'lucide-react'

interface Client {
  id: string
  name: string
  created_at: string
  onboarding_completed: boolean
  admin_name: string | null
  whatsapp_connected: boolean
  whatsapp_status: string | null
}

interface ConnHealth {
  business_id: string
  business_name: string
  connected: boolean
  bot_enabled: boolean
  state: string | null
  stateLabel: string
  tone: 'good' | 'warn' | 'bad' | 'unknown'
  queueSize: number | null
  last_message_at: string | null
  checkError: string | null
}

const TONE_COLORS: Record<ConnHealth['tone'], { bg: string; text: string; dot: string }> = {
  good:    { bg: '#F0FDF4', text: '#16A34A', dot: '#22C55E' },
  warn:    { bg: '#FFFBEB', text: '#B45309', dot: '#F59E0B' },
  bad:     { bg: '#FEF2F2', text: '#DC2626', dot: '#EF4444' },
  unknown: { bg: 'var(--bg-hover)', text: 'var(--fg-4)', dot: 'var(--fg-4)' },
}

export default function AdminPage() {
  const supabase = createClient()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [form, setForm] = useState({ businessName: '', clientEmail: '', clientFullName: '' })
  const [connHealth, setConnHealth] = useState<ConnHealth[]>([])
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'superadmin') { setLoading(false); setIsSuperAdmin(false); return }
    setIsSuperAdmin(true)
    await loadClients()
    await checkConnectionsHealth()
  }

  async function loadClients() {
    setLoading(true)
    const res = await fetch('/api/admin/clients')
    if (res.ok) {
      const json = await res.json()
      setClients(json.clients || [])
    }
    setLoading(false)
  }

  /* מצב חיבור WhatsApp בזמן אמת לכל הלקוחות — בלי להתחבר לאף חשבון לקוח.
     כפתור ידני ולא פולינג אוטומטי, כדי לא להטריח את Green API סתם. */
  async function checkConnectionsHealth() {
    setCheckingHealth(true)
    try {
      const res = await fetch('/api/admin/connections-health')
      if (res.ok) {
        const json = await res.json()
        setConnHealth(json.connections || [])
        setHealthCheckedAt(json.checked_at || new Date().toISOString())
      }
    } catch { /* המסך ימשיך להראות את הנתונים הקודמים */ }
    setCheckingHealth(false)
  }

  async function createClient_() {
    if (!form.businessName.trim() || !form.clientEmail.trim()) {
      setMsg({ ok: false, text: 'שם עסק ואימייל הם שדות חובה' }); return
    }
    setCreating(true); setMsg(null)
    const res = await fetch('/api/admin/create-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const json = await res.json()
    setCreating(false)
    if (!json.ok) {
      setMsg({ ok: false, text: json.error || 'שגיאה ביצירת לקוח' })
    } else {
      setMsg({ ok: true, text: `✓ הלקוח נוצר! הזמנה נשלחה ל-${form.clientEmail}` })
      setForm({ businessName: '', clientEmail: '', clientFullName: '' })
      await loadClients()
      setTimeout(() => { setShowModal(false); setMsg(null) }, 2500)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)' }} />
    </div>
  )

  if (!isSuperAdmin) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 40 }}>🔒</span>
      <p style={{ color: 'var(--fg-3)', fontWeight: 500 }}>אין לך הרשאה לדף זה</p>
    </div>
  )

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>ניהול לקוחות</h1>
            <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>{clients.length} לקוחות פעילים</p>
          </div>
        </div>
        <button onClick={() => { setShowModal(true); setMsg(null) }} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', borderRadius: 10, border: 'none',
          background: 'var(--brand)', color: 'white',
          fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          <Plus size={16} />
          הוסף לקוח חדש
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'סה"כ לקוחות', value: clients.length, color: 'var(--brand)' },
          { label: 'השלימו אונבורדינג', value: clients.filter(c => c.onboarding_completed).length, color: '#16A34A' },
          { label: 'WhatsApp מחובר', value: clients.filter(c => c.whatsapp_connected).length, color: '#25D366' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: s.color, margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '4px 0 0' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* WhatsApp connections health — בדיקה חיה בלי להתחבר כאף לקוח */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={18} style={{ color: 'var(--brand)' }} />
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>בריאות חיבור WhatsApp</h2>
              {healthCheckedAt && (
                <p style={{ fontSize: 11, color: 'var(--fg-4)', margin: '2px 0 0' }}>
                  נבדק לאחרונה: {new Date(healthCheckedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
          <button onClick={checkConnectionsHealth} disabled={checkingHealth} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, border: '1.5px solid var(--border)',
            background: 'transparent', color: 'var(--fg-2)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: checkingHealth ? 'default' : 'pointer',
          }}>
            <RefreshCw size={13} style={checkingHealth ? { animation: 'spin 1s linear infinite' } : undefined} />
            {checkingHealth ? 'בודק...' : 'בדוק שוב'}
          </button>
        </div>

        {connHealth.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--fg-4)', textAlign: 'center', padding: '20px 0' }}>
            {checkingHealth ? 'בודק חיבורים...' : 'אין נתונים עדיין'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connHealth.map(c => {
              const tone = TONE_COLORS[c.tone]
              return (
                <div key={c.business_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 10, background: 'var(--bg-hover)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.business_name}
                    </span>
                    {!c.bot_enabled && c.connected && (
                      <span style={{ fontSize: 10, color: 'var(--fg-4)', background: 'var(--bg-canvas)', padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>
                        בוט כבוי
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {c.queueSize != null && c.queueSize > 0 && (
                      <span style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>
                        {c.queueSize} תקועות בתור
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                      background: tone.bg, color: tone.text, whiteSpace: 'nowrap',
                    }}>
                      {c.connected ? (c.checkError || c.stateLabel) : 'לא מחובר'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Clients list */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: 36, margin: '0 0 12px' }}>🏢</p>
            <p style={{ color: 'var(--fg-3)', fontWeight: 500 }}>אין לקוחות עדיין</p>
            <p style={{ color: 'var(--fg-4)', fontSize: 13 }}>לחץ "הוסף לקוח חדש" כדי להתחיל</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['עסק', 'איש קשר', 'WhatsApp', 'אונבורדינג', 'תאריך הצטרפות'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', letterSpacing: '0.03em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Building2 size={16} color="var(--fg-3)" />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg-1)' }}>{c.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{c.admin_name || '—'}</span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {c.whatsapp_connected
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#16A34A', background: '#F0FDF4', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>
                          <Wifi size={12} />מחובר
                        </span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-4)', background: 'var(--bg-hover)', padding: '3px 10px', borderRadius: 20 }}>
                          <WifiOff size={12} />לא מחובר
                        </span>
                    }
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {c.onboarding_completed
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#16A34A', fontWeight: 600 }}><CheckCircle2 size={14} />הושלם</span>
                      : <span style={{ fontSize: 12, color: '#D97706', fontWeight: 500 }}>בהמתנה</span>
                    }
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                      {new Date(c.created_at).toLocaleDateString('he-IL')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create client modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--fg-1)' }}>לקוח חדש</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: 6 }}>
                  <Building2 size={13} style={{ marginLeft: 5, verticalAlign: 'middle' }} />
                  שם העסק *
                </label>
                <input
                  value={form.businessName}
                  onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))}
                  placeholder="שקד קליניק"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: 6 }}>
                  <User size={13} style={{ marginLeft: 5, verticalAlign: 'middle' }} />
                  שם איש הקשר
                </label>
                <input
                  value={form.clientFullName}
                  onChange={e => setForm(f => ({ ...f, clientFullName: e.target.value }))}
                  placeholder="ד״ר שקד לוי"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: 6 }}>
                  <Mail size={13} style={{ marginLeft: 5, verticalAlign: 'middle' }} />
                  אימייל לקוח *
                </label>
                <input
                  value={form.clientEmail}
                  onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))}
                  placeholder="shaked@clinic.co.il"
                  type="email"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', boxSizing: 'border-box' }}
                />
                <p style={{ fontSize: 12, color: 'var(--fg-4)', margin: '6px 0 0' }}>הלקוח יקבל אימייל הזמנה עם קישור להגדרת סיסמה</p>
              </div>
            </div>

            {msg && (
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: msg.ok ? '#F0FDF4' : '#FEF2F2', color: msg.ok ? '#16A34A' : '#DC2626', fontSize: 13, fontWeight: 500 }}>
                {msg.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer' }}>
                ביטול
              </button>
              <button onClick={createClient_} disabled={creating} style={{ flex: 2, padding: '11px', borderRadius: 8, border: 'none', background: creating ? 'var(--fg-4)' : 'var(--brand)', color: 'white', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {creating ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />יוצר לקוח...</> : 'צור לקוח ושלח הזמנה'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
