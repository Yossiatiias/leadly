'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Check, Plus, X } from 'lucide-react'

interface Service {
  name: string
  price: string
  duration: string
  active: boolean
}

interface WorkingDay {
  day: string
  open: string
  close: string
  closed: boolean
}

interface Business {
  id: string
  settings: Record<string, any>
}

const DEFAULT_HOURS: WorkingDay[] = [
  { day: 'ראשון',  open: '09:00', close: '18:00', closed: false },
  { day: 'שני',    open: '09:00', close: '18:00', closed: false },
  { day: 'שלישי', open: '09:00', close: '18:00', closed: false },
  { day: 'רביעי', open: '09:00', close: '18:00', closed: false },
  { day: 'חמישי', open: '09:00', close: '18:00', closed: false },
  { day: 'שישי',  open: '09:00', close: '13:00', closed: false },
  { day: 'שבת',   open: '',      close: '',      closed: true },
]

const GOALS = [
  { value: 'appointment', label: 'קביעת תור' },
  { value: 'lead',        label: 'השארת פרטים' },
  { value: 'info',        label: 'מתן מידע' },
  { value: 'sale',        label: 'מכירה ישירה' },
]

const TABS = ['כללי', 'שעות פעילות', 'בוט WhatsApp', 'שירותים', 'תורים'] as const
type Tab = typeof TABS[number]

export default function SettingsPage() {
  const supabase = createClient()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('כללי')

  const [general, setGeneral] = useState({ name: '', industry: '', address: '', phone: '', email: '', website: '' })
  const [hours, setHours] = useState<WorkingDay[]>(DEFAULT_HOURS)
  const [bot, setBot] = useState({ greeting: '', goal: 'appointment', escalation_rule: '', auto_reply_hours: '24', description: '' })
  const [services, setServices] = useState<Service[]>([])
  const [apptSettings, setApptSettings] = useState({ default_duration: '30', booking_window_days: '60' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    const { data } = await supabase.from('businesses').select('*').eq('id', profile.business_id).single()
    if (data) {
      setBusiness(data)
      const s = data.settings || {}
      setGeneral({ name: data.name || '', industry: data.industry || '', address: data.address || '', phone: s.phone || '', email: s.email || '', website: data.website || '' })
      setHours(s.working_hours_table || DEFAULT_HOURS)
      setBot({ greeting: s.greeting || '', goal: s.goal || 'appointment', escalation_rule: s.escalation_rule || '', auto_reply_hours: s.auto_reply_hours || '24', description: s.description || '' })
      setServices(s.services || [])
      setApptSettings({ default_duration: s.default_duration || '30', booking_window_days: s.booking_window_days || '60' })
    }
    setLoading(false)
  }

  async function save() {
    if (!business) return
    setSaving(true)
    await supabase.from('businesses').update({
      name: general.name,
      industry: general.industry,
      address: general.address,
      website: general.website,
      settings: {
        phone: general.phone,
        email: general.email,
        description: bot.description,
        working_hours_table: hours,
        greeting: bot.greeting,
        goal: bot.goal,
        escalation_rule: bot.escalation_rule,
        auto_reply_hours: bot.auto_reply_hours,
        services,
        default_duration: apptSettings.default_duration,
        booking_window_days: apptSettings.booking_window_days,
      },
    }).eq('id', business.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function updateHour(i: number, field: keyof WorkingDay, value: any) {
    setHours(h => h.map((d, idx) => idx === i ? { ...d, [field]: value } : d))
  }

  function addService() {
    setServices(s => [...s, { name: '', price: '', duration: '30', active: true }])
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)' }}>טוען...</div>

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: '8px',
    border: '1px solid var(--border-default)', fontSize: '13px', fontFamily: 'inherit',
    boxSizing: 'border-box', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none',
  }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '5px' }
  const sec: React.CSSProperties = { background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: '1px solid var(--border-subtle)' }

  return (
    <div style={{ padding: '28px', maxWidth: '760px', margin: '0 auto', direction: 'rtl' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>הגדרות עסק</h1>
        <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginTop: '3px' }}>מידע זה מוזן לסוכן ה-AI ומשמש לניהול העסק</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-surface)', borderRadius: '10px', padding: '4px', border: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '7px 6px', borderRadius: '7px', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '12px', fontWeight: tab === t ? 600 : 400,
            background: tab === t ? 'var(--brand)' : 'transparent',
            color: tab === t ? 'white' : 'var(--fg-3)',
            transition: 'all 0.12s',
          }}>{t}</button>
        ))}
      </div>

      {/* ── כללי ── */}
      {tab === 'כללי' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>פרטי העסק</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={lbl}>שם העסק *</label>
              <input value={general.name} onChange={e => setGeneral(g => ({ ...g, name: e.target.value }))} placeholder="קליניקת שיניים יוסי" style={inp} />
            </div>
            <div>
              <label style={lbl}>תחום עיסוק</label>
              <input value={general.industry} onChange={e => setGeneral(g => ({ ...g, industry: e.target.value }))} placeholder="רפואת שיניים" style={inp} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>כתובת</label>
              <input value={general.address} onChange={e => setGeneral(g => ({ ...g, address: e.target.value }))} placeholder="רחוב הרצל 1, תל אביב" style={inp} />
            </div>
            <div>
              <label style={lbl}>טלפון</label>
              <input value={general.phone} onChange={e => setGeneral(g => ({ ...g, phone: e.target.value }))} placeholder="03-0000000" dir="ltr" style={inp} />
            </div>
            <div>
              <label style={lbl}>אימייל</label>
              <input value={general.email} onChange={e => setGeneral(g => ({ ...g, email: e.target.value }))} placeholder="info@clinic.co.il" dir="ltr" style={inp} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>אתר אינטרנט</label>
              <input value={general.website} onChange={e => setGeneral(g => ({ ...g, website: e.target.value }))} placeholder="https://www.clinic.co.il" dir="ltr" style={inp} />
            </div>
          </div>
        </div>
      )}

      {/* ── שעות פעילות ── */}
      {tab === 'שעות פעילות' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>שעות פעילות</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* header */}
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', paddingBottom: '6px', borderBottom: '1px solid var(--border-subtle)' }}>
              {['יום', 'פתיחה', 'סגירה', 'סגור'].map(h => (
                <span key={h} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', letterSpacing: '0.04em' }}>{h}</span>
              ))}
            </div>
            {hours.map((d, i) => (
              <div key={d.day} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)' }}>{d.day}</span>
                <input type="time" value={d.open} disabled={d.closed} onChange={e => updateHour(i, 'open', e.target.value)}
                  style={{ ...inp, opacity: d.closed ? 0.4 : 1 }} />
                <input type="time" value={d.close} disabled={d.closed} onChange={e => updateHour(i, 'close', e.target.value)}
                  style={{ ...inp, opacity: d.closed ? 0.4 : 1 }} />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <input type="checkbox" checked={d.closed} onChange={e => updateHour(i, 'closed', e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── בוט WhatsApp ── */}
      {tab === 'בוט WhatsApp' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>הגדרות בוט WhatsApp</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={lbl}>תיאור העסק — מה ה-AI יידע</label>
              <textarea value={bot.description} onChange={e => setBot(b => ({ ...b, description: e.target.value }))}
                placeholder="קליניקת שיניים מתקדמת בתל אביב. מתמחים בהשתלות, ציפויים ויישור שיניים..."
                rows={3} style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div>
              <label style={lbl}>הודעת פתיחה</label>
              <textarea value={bot.greeting} onChange={e => setBot(b => ({ ...b, greeting: e.target.value }))}
                placeholder="שלום! אני הסוכן הוירטואלי של הקליניקה. כיצד אוכל לעזור? 😊"
                rows={2} style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div>
              <label style={lbl}>מטרת הסוכן</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {GOALS.map(g => (
                  <div key={g.value} onClick={() => setBot(b => ({ ...b, goal: g.value }))} style={{
                    padding: '9px 14px', borderRadius: '8px', cursor: 'pointer',
                    border: `2px solid ${bot.goal === g.value ? 'var(--brand)' : 'var(--border-default)'}`,
                    background: bot.goal === g.value ? 'var(--brand-soft)' : 'transparent',
                    color: bot.goal === g.value ? 'var(--brand)' : 'var(--fg-3)',
                    fontSize: '13px', fontWeight: bot.goal === g.value ? 600 : 400, transition: 'all 0.12s',
                  }}>{g.label}</div>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>מתי להעביר לנציג אנושי?</label>
              <input value={bot.escalation_rule} onChange={e => setBot(b => ({ ...b, escalation_rule: e.target.value }))}
                placeholder="אם הלקוח כועס, מבקש לדבר עם אדם, או שואל על מחיר ספציפי" style={inp} />
            </div>
            <div style={{ maxWidth: '240px' }}>
              <label style={lbl}>שעות מענה אוטומטי</label>
              <select value={bot.auto_reply_hours} onChange={e => setBot(b => ({ ...b, auto_reply_hours: e.target.value }))} style={inp}>
                <option value="24">24 שעות ביממה</option>
                <option value="business">שעות פעילות בלבד</option>
                <option value="off">כבוי</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── שירותים ── */}
      {tab === 'שירותים' && (
        <div style={sec}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>שירותים ומחירים</h3>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '3px 0 0' }}>ה-AI ישתמש בזה לענות על שאלות מחיר ומשך טיפול</p>
            </div>
            <button onClick={addService} style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px',
              borderRadius: '8px', border: 'none', background: 'var(--brand)', color: 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
            }}>
              <Plus size={12} /> הוסף שירות
            </button>
          </div>
          {services.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px', color: 'var(--fg-4)', fontSize: '13px',
              background: 'var(--bg-sunken)', borderRadius: '10px', border: '1px dashed var(--border-default)' }}>
              לחץ "+ הוסף שירות" להוספת הטיפולים שאתה מציע
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 100px 50px 30px', gap: '8px' }}>
                {['שם שירות', 'מחיר (₪)', 'משך (דק׳)', 'פעיל', ''].map(h => (
                  <span key={h} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)' }}>{h}</span>
                ))}
              </div>
              {services.map((svc, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 100px 100px 50px 30px', gap: '8px', alignItems: 'center', background: 'var(--bg-sunken)', padding: '8px 10px', borderRadius: '8px' }}>
                  <input value={svc.name} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="השתלת שן" style={{ ...inp, padding: '6px 10px', fontSize: '12px' }} />
                  <input value={svc.price} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                    placeholder="2000" style={{ ...inp, padding: '6px 10px', fontSize: '12px' }} />
                  <input value={svc.duration} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))}
                    placeholder="60" style={{ ...inp, padding: '6px 10px', fontSize: '12px' }} />
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <input type="checkbox" checked={svc.active} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--brand)', cursor: 'pointer' }} />
                  </div>
                  <button onClick={() => setServices(s => s.filter((_, j) => j !== i))} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', alignItems: 'center',
                  }}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── תורים ── */}
      {tab === 'תורים' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>הגדרות תורים</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={lbl}>משך ברירת מחדל לתור (דקות)</label>
              <select value={apptSettings.default_duration} onChange={e => setApptSettings(a => ({ ...a, default_duration: e.target.value }))} style={inp}>
                {[15, 30, 45, 60, 90, 120].map(d => <option key={d} value={String(d)}>{d} דקות</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>חלון קביעת תורים (ימים קדימה)</label>
              <select value={apptSettings.booking_window_days} onChange={e => setApptSettings(a => ({ ...a, booking_window_days: e.target.value }))} style={inp}>
                {[7, 14, 30, 60, 90].map(d => <option key={d} value={String(d)}>{d} יום</option>)}
              </select>
            </div>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '16px' }}>
            הסוכן ישתמש בהגדרות אלו בעת הצעת תורים ללקוחות בשיחות WhatsApp.
          </p>
        </div>
      )}

      {/* Save */}
      <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={save} disabled={saving || !general.name.trim()} style={{
          padding: '10px 28px', borderRadius: '10px', border: 'none',
          background: saving ? 'var(--brand-soft)' : 'var(--brand)',
          color: saving ? 'var(--brand)' : 'white',
          fontFamily: 'inherit', fontWeight: 600, fontSize: '14px',
          cursor: saving ? 'default' : 'pointer',
        }}>
          {saving ? 'שומר...' : 'שמור הגדרות'}
        </button>
        {saved && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>
            <Check size={14} /> נשמר בהצלחה
          </span>
        )}
      </div>
    </div>
  )
}
