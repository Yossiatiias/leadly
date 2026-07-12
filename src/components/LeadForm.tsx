'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Profile, Lead } from '@/types'
import { TREATMENT_LABELS } from '@/types'

const SOURCES = [
  { value: 'manual',     label: 'הזנה ידנית' },
  { value: 'backoffice', label: 'בקאופיס' },
  { value: 'whatsapp',   label: 'בוט וואטסאפ' },
  { value: 'social',     label: 'רשתות חברתיות' },
  { value: 'outreach',   label: 'פנייה יזומה' },
  { value: 'scrape',     label: 'סריקה' },
  { value: 'bot',        label: 'בוט' },
]

const STATUSES = [
  { value: 'new',            label: 'חדש' },
  { value: 'contacted',      label: 'אין מענה' },
  { value: 'in_progress',    label: 'למעקב' },
  { value: 'published',      label: 'נקבע תור' },
  { value: 'no_show',        label: 'לא הגיע' },
  { value: 'arrived',        label: 'הגיע' },
  { value: 'quote_sent',     label: 'הצעת מחיר' },
  { value: 'quote_followup', label: 'מעקב אחר הצעה' },
  { value: 'closed',         label: 'נסגר' },
  { value: 'lost',           label: 'אבוד' },
  { value: 'not_relevant',   label: 'לא רלוונטי' },
]

const TREATMENT_OPTIONS = [
  { value: '',             label: '— ללא —' },
  { value: 'implant',      label: 'השתלות' },
  { value: 'restorative',  label: 'טיפול משמר' },
  { value: 'veneers',      label: 'ציפויים' },
  { value: 'whitening',    label: 'הלבנה' },
  { value: 'orthodontics', label: 'יישור שיניים' },
  { value: 'checkup',      label: 'בדיקה ואבחון' },
  { value: 'other',        label: 'אחר' },
]

interface Props {
  profiles: Profile[]
  lead?: Lead
}

export default function LeadForm({ profiles, lead }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const defaultFollowup = new Date()
  defaultFollowup.setDate(defaultFollowup.getDate() + 3)

  const [form, setForm] = useState({
    name:             lead?.name || '',
    phone:            lead?.phone || '',
    email:            lead?.email || '',
    source:           lead?.source || 'manual',
    status:           lead?.status || 'new',
    temperature:      lead?.temperature || 'medium',
    treatment_type:   lead?.treatment_type || '',
    assigned_to:      lead?.assigned_to || '',
    notes:            lead?.notes || '',
    campaign_name:    lead?.campaign_name || '',
    company_name:     lead?.company_name || '',
    clinic_count:     lead?.clinic_count?.toString() || '',
    discount_percent: lead?.discount_percent?.toString() || '',
    next_followup:    lead?.next_followup
      ? new Date(lead.next_followup).toISOString().split('T')[0]
      : defaultFollowup.toISOString().split('T')[0],
  })

  function set(field: string, value: string) {
    setForm(f => {
      const next = { ...f, [field]: value }
      // Auto follow-up: 24h after switching to "למעקב"
      if (field === 'status' && value === 'in_progress') {
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
        next.next_followup = in24h.toISOString().split('T')[0]
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const payload = {
      name:             form.name,
      phone:            form.phone || null,
      email:            form.email || null,
      source:           form.source,
      status:           form.status,
      temperature:      form.temperature,
      treatment_type:   form.treatment_type || null,
      assigned_to:      form.assigned_to || null,
      notes:            form.notes || null,
      campaign_name:    form.campaign_name || null,
      company_name:     form.company_name || null,
      clinic_count:     form.clinic_count ? parseInt(form.clinic_count) : null,
      discount_percent: form.discount_percent ? parseInt(form.discount_percent) : null,
      next_followup:    form.next_followup || null,
    }

    const result = lead
      ? await supabase.from('leads').update(payload).eq('id', lead.id)
      : await supabase.from('leads').insert(payload)

    if (result.error) {
      setError('שגיאה בשמירה: ' + result.error.message)
      setLoading(false)
    } else {
      if (lead && payload.name && payload.name !== lead.name) {
        await supabase
          .from('conversations')
          .update({ contact_name: payload.name })
          .eq('lead_id', lead.id)
      }
      router.push('/leads')
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 space-y-5">
      {/* Name + Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>שם מלא *</label>
          <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required className="input-base" placeholder="ישראל ישראלי" />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>טלפון</label>
          <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className="input-base" dir="ltr" placeholder="050-0000000" />
        </div>
      </div>

      {/* Email */}
      <div>
        <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>אימייל</label>
        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input-base" dir="ltr" placeholder="name@example.com" />
      </div>

      {/* Company + Clinic count */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>שם מתחם / חברה</label>
          <input type="text" value={form.company_name} onChange={e => set('company_name', e.target.value)} className="input-base" placeholder="מרכז רפואי X" />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>מספר קליניקות</label>
          <input type="number" value={form.clinic_count} onChange={e => set('clinic_count', e.target.value)} className="input-base" placeholder="5" min="1" />
        </div>
      </div>

      {/* Source + Status */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>מקור</label>
          <select value={form.source} onChange={e => set('source', e.target.value)} className="input-base">
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>סטטוס</label>
          <select value={form.status} onChange={e => set('status', e.target.value)} className="input-base">
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Treatment type */}
      <div>
        <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>סוג טיפול</label>
        <select value={form.treatment_type} onChange={e => set('treatment_type', e.target.value)} className="input-base">
          {TREATMENT_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {form.source === 'social' && (
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>שם קמפיין</label>
          <input type="text" value={form.campaign_name} onChange={e => set('campaign_name', e.target.value)} className="input-base" />
        </div>
      )}

      {/* Salesperson + Follow-up */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>איש מכירות</label>
          <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} className="input-base">
            <option value="">— לא מוקצה —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>
            follow-up הבא
            {form.status === 'in_progress' && <span style={{ color: '#10B981', marginRight: '6px', fontSize: '10px', fontWeight: 400 }}>נקבע אוטומטית 24 שע׳</span>}
          </label>
          <input type="date" value={form.next_followup} onChange={e => set('next_followup', e.target.value)} className="input-base" dir="ltr" />
        </div>
      </div>

      {/* Discount */}
      <div>
        <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>הנחה שהוצעה (%)</label>
        <input type="number" value={form.discount_percent} onChange={e => set('discount_percent', e.target.value)} className="input-base" placeholder="10" min="0" max="100" />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>מידע כללי רלוונטי</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className="input-base resize-none" placeholder="מידע נוסף על הליד, מה ביקש, מה אמר..." />
      </div>

      {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100">{error}</div>}

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
          {loading ? 'שומר...' : lead ? 'עדכן ליד' : '+ הוסף ליד'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">ביטול</button>
      </div>
    </form>
  )
}
