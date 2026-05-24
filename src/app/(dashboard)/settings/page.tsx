'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Service {
  name: string
  price: string
  duration: string
  description: string
}

interface Business {
  id: string
  name: string
  industry: string | null
  address: string | null
  website: string | null
  settings: {
    description?: string
    working_hours?: string
    greeting?: string
    goal?: string
    escalation_rule?: string
    followup_hours?: string
    services?: Service[]
  }
}

const GOALS = [
  { value: 'appointment', label: 'קביעת תור / פגישה' },
  { value: 'lead', label: 'השארת פרטים ליצירת קשר' },
  { value: 'info', label: 'מתן מידע בלבד' },
  { value: 'sale', label: 'מכירה ישירה' },
]

export default function SettingsPage() {
  const supabase = createClient()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const [form, setForm] = useState({
    name: '',
    industry: '',
    address: '',
    website: '',
    description: '',
    working_hours: '',
    greeting: '',
    goal: 'appointment',
    escalation_rule: '',
    followup_hours: '24',
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.business_id) return

    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', profile.business_id)
      .single()

    if (data) {
      setBusiness(data)
      setForm({
        name: data.name || '',
        industry: data.industry || '',
        address: data.address || '',
        website: data.website || '',
        description: data.settings?.description || '',
        working_hours: data.settings?.working_hours || '',
        greeting: data.settings?.greeting || '',
        goal: data.settings?.goal || 'appointment',
        escalation_rule: data.settings?.escalation_rule || '',
        followup_hours: data.settings?.followup_hours || '24',
      })
      setServices(data.settings?.services || [])
    }
    setLoading(false)
  }

  async function save() {
    if (!business) return
    setSaving(true)

    await supabase.from('businesses').update({
      name: form.name,
      industry: form.industry,
      address: form.address,
      website: form.website,
      settings: {
        ...business.settings,
        description: form.description,
        working_hours: form.working_hours,
        greeting: form.greeting,
        goal: form.goal,
        escalation_rule: form.escalation_rule,
        followup_hours: form.followup_hours,
        services,
      },
    }).eq('id', business.id)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    loadData()
  }

  function addService() {
    setServices(s => [...s, { name: '', price: '', duration: '60', description: '' }])
  }

  function updateService(i: number, field: keyof Service, value: string) {
    setServices(s => s.map((svc, idx) => idx === i ? { ...svc, [field]: value } : svc))
  }

  function removeService(i: number) {
    setServices(s => s.filter((_, idx) => idx !== i))
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)' }}>טוען...</div>

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: '1px solid var(--border-default)', fontSize: '14px', fontFamily: 'inherit',
    boxSizing: 'border-box' as const, outline: 'none', color: 'var(--fg-1)' as string,
    background: 'var(--bg-sunken)' as string,
  }

  const labelStyle = {
    display: 'block' as const, fontSize: '13px', fontWeight: 600 as const,
    color: 'var(--fg-2)' as string, marginBottom: '6px',
  }

  const sectionStyle = {
    background: 'var(--bg-surface)' as string, borderRadius: '16px', padding: '24px',
    border: '1px solid var(--border-default)', marginBottom: '20px',
  }

  return (
    <div style={{ padding: '32px', maxWidth: '720px', margin: '0 auto', direction: 'rtl' }}>

      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>הגדרות עסק</h1>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', marginTop: '4px' }}>
          המידע הזה מוזן לסוכן ה-AI כדי שיוכל לענות ללקוחות בצורה מדויקת
        </p>
      </div>

      {/* Basic Info */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--fg-1)', margin: '0 0 20px' }}>פרטי עסק בסיסיים</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>שם העסק</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="למשל: קליניקת יוסי" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>תחום עיסוק</label>
            <input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
              placeholder="קליניקה, מספרה, עורך דין..." style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>כתובת</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="רחוב, עיר" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>אתר אינטרנט</label>
            <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://www.example.com" style={inputStyle} />
          </div>
        </div>
      </div>

      {/* AI Settings */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--fg-1)', margin: '0 0 6px' }}>🤖 הגדרות סוכן AI</h3>
        <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 20px' }}>ככל שתכתוב יותר פרטים — כך ה-AI יענה טוב יותר</p>

        {/* Goal */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>מטרת הסוכן — מה הוא אמור להשיג?</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {GOALS.map(g => (
              <div
                key={g.value}
                onClick={() => setForm(f => ({ ...f, goal: g.value }))}
                style={{
                  padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                  border: `2px solid ${form.goal === g.value ? '#3FA9DC' : 'var(--border-default)'}`,
                  background: form.goal === g.value ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  color: form.goal === g.value ? 'var(--fg-1)' : 'var(--fg-3)',
                  fontSize: '13px', fontWeight: form.goal === g.value ? 700 : 500,
                  transition: 'all 0.15s',
                }}
              >
                {g.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>תיאור העסק</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="תאר את העסק שלך — מה אתה מציע, מה הייחוד שלך, לאיזה קהל אתה פונה..."
            rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>שעות פעילות</label>
          <textarea value={form.working_hours} onChange={e => setForm(f => ({ ...f, working_hours: e.target.value }))}
            placeholder="ימים א׳-ה׳ 9:00-18:00, שישי 9:00-13:00, שבת סגור"
            rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>הודעת פתיחה</label>
          <textarea value={form.greeting} onChange={e => setForm(f => ({ ...f, greeting: e.target.value }))}
            placeholder="שלום! אני הסוכן הוירטואלי של קליניקת יוסי. איך אוכל לעזור לך היום? 😊"
            rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>מתי להעביר לנציג אנושי?</label>
            <input value={form.escalation_rule} onChange={e => setForm(f => ({ ...f, escalation_rule: e.target.value }))}
              placeholder="למשל: אם הלקוח כועס או מבקש לדבר עם אדם"
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>פולואפ — כמה שעות להמתין?</label>
            <select value={form.followup_hours} onChange={e => setForm(f => ({ ...f, followup_hours: e.target.value }))}
              style={{ ...inputStyle }}>
              <option value="6">6 שעות</option>
              <option value="12">12 שעות</option>
              <option value="24">24 שעות</option>
              <option value="48">48 שעות</option>
              <option value="72">72 שעות</option>
            </select>
          </div>
        </div>
      </div>

      {/* Services */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>💼 שירותים ומחירים</h3>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '4px 0 0' }}>ה-AI ישתמש בזה כדי לענות על שאלות מחיר וזמן</p>
          </div>
          <button onClick={addService} style={{
            padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: '#3FA9DC', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
          }}>
            + הוסף שירות
          </button>
        </div>

        {services.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--fg-3)', fontSize: '13px',
            background: 'var(--bg-sunken)', borderRadius: '10px', border: '1px dashed var(--border-default)' }}>
            אין שירותים עדיין — לחץ "+ הוסף שירות"
          </div>
        )}

        {services.map((svc, i) => (
          <div key={i} style={{
            background: 'var(--bg-sunken)', borderRadius: '10px', padding: '16px',
            marginBottom: '12px', border: '1px solid var(--border-default)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
              <div>
                <label style={{ ...labelStyle, fontSize: '11px' }}>שם השירות</label>
                <input value={svc.name} onChange={e => updateService(i, 'name', e.target.value)}
                  placeholder="למשל: טיפול גב" style={{ ...inputStyle, background: 'var(--bg-surface)' }} />
              </div>
              <div>
                <label style={{ ...labelStyle, fontSize: '11px' }}>מחיר (₪)</label>
                <input value={svc.price} onChange={e => updateService(i, 'price', e.target.value)}
                  placeholder="250" style={{ ...inputStyle, background: 'var(--bg-surface)' }} />
              </div>
              <div>
                <label style={{ ...labelStyle, fontSize: '11px' }}>משך (דקות)</label>
                <input value={svc.duration} onChange={e => updateService(i, 'duration', e.target.value)}
                  placeholder="60" style={{ ...inputStyle, background: 'var(--bg-surface)' }} />
              </div>
              <button onClick={() => removeService(i)} style={{
                width: '32px', height: '36px', borderRadius: '6px', border: 'none',
                background: 'var(--bg-hover)', color: '#EF4444', cursor: 'pointer', fontSize: '14px',
                marginTop: '18px',
              }}>✕</button>
            </div>
            <div style={{ marginTop: '10px' }}>
              <label style={{ ...labelStyle, fontSize: '11px' }}>תיאור קצר (אופציונלי)</label>
              <input value={svc.description} onChange={e => updateService(i, 'description', e.target.value)}
                placeholder="תיאור קצר של השירות" style={{ ...inputStyle, background: 'var(--bg-surface)' }} />
            </div>
          </div>
        ))}
      </div>

      {saved && (
        <div style={{
          padding: '12px 16px', borderRadius: '10px', background: '#E8F8EC',
          color: '#2E7D32', fontSize: '14px', fontWeight: 600, marginBottom: '16px', textAlign: 'center',
        }}>
          ✓ נשמר בהצלחה
        </div>
      )}

      <button onClick={save} disabled={saving || !form.name.trim()} style={{
        width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
        background: saving ? '#A8D5EE' : '#3FA9DC', color: 'white',
        fontFamily: 'inherit', fontWeight: 700, fontSize: '15px',
        cursor: saving ? 'default' : 'pointer',
      }}>
        {saving ? 'שומר...' : 'שמור הגדרות'}
      </button>
    </div>
  )
}
