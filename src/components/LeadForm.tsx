'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Profile, Lead } from '@/types'
import { Paperclip, Upload, X, FileText, Loader2 } from 'lucide-react'

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

interface AttachedFile { name: string; url: string; size: number | null; type: string | null; id: string }

interface Props {
  profiles: Profile[]
  lead?: Lead
  businessId?: string
}

export default function LeadForm({ profiles, lead, businessId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const defaultFollowup = new Date()
  defaultFollowup.setDate(defaultFollowup.getDate() + 3)

  const [form, setForm] = useState({
    first_name:    lead?.first_name || (lead?.name ? lead.name.split(' ')[0] : ''),
    last_name:     lead?.last_name  || (lead?.name && lead.name.includes(' ') ? lead.name.slice(lead.name.indexOf(' ') + 1) : ''),
    phone:         lead?.phone || '',
    email:         lead?.email || '',
    source:        lead?.source || 'manual',
    status:        lead?.status || 'new',
    treatment_type: lead?.treatment_type || '',
    assigned_to:   lead?.assigned_to || '',
    notes:         lead?.notes || '',
    campaign_name: lead?.campaign_name || '',
    next_followup: lead?.next_followup
      ? new Date(lead.next_followup).toISOString().split('T')[0]
      : defaultFollowup.toISOString().split('T')[0],
  })

  function set(field: string, value: string) {
    setForm(f => {
      const next = { ...f, [field]: value }
      if (field === 'status' && value === 'in_progress') {
        const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
        next.next_followup = in24h.toISOString().split('T')[0]
      }
      return next
    })
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !lead?.id) return
    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${lead.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('lead-files').upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('lead-files').getPublicUrl(path)
      const bId = businessId || (await supabase.from('leads').select('business_id').eq('id', lead.id).single()).data?.business_id
      await supabase.from('lead_files').insert({
        lead_id: lead.id, business_id: bId,
        file_name: file.name, file_url: publicUrl,
        file_size: file.size, file_type: file.type,
      })
      setAttachedFiles(prev => [...prev, { name: file.name, url: publicUrl, size: file.size, type: file.type, id: Date.now().toString() }])
    } catch (err) {
      setError('שגיאה בהעלאת קובץ')
    } finally {
      setUploadingFile(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeFile(id: string) {
    setAttachedFiles(prev => prev.filter(f => f.id !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const fullName = [form.first_name, form.last_name].filter(Boolean).join(' ')
    const payload = {
      name:           fullName,
      first_name:     form.first_name || null,
      last_name:      form.last_name || null,
      phone:          form.phone || null,
      email:          form.email || null,
      source:         form.source,
      status:         form.status,
      treatment_type: form.treatment_type || null,
      assigned_to:    form.assigned_to || null,
      notes:          form.notes || null,
      campaign_name:  form.campaign_name || null,
      next_followup:  form.next_followup || null,
    }

    const result = lead
      ? await supabase.from('leads').update(payload).eq('id', lead.id)
      : await supabase.from('leads').insert(payload)

    if (result.error) {
      setError('שגיאה בשמירה: ' + result.error.message)
      setLoading(false)
    } else {
      if (lead && fullName && fullName !== lead.name) {
        await supabase.from('conversations').update({ contact_name: fullName }).eq('lead_id', lead.id)
      }
      router.push('/leads')
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 space-y-5">
      {/* First name + Last name */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>שם פרטי *</label>
          <input type="text" value={form.first_name} onChange={e => set('first_name', e.target.value)} required className="input-base" placeholder="ישראל" />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>שם משפחה</label>
          <input type="text" value={form.last_name} onChange={e => set('last_name', e.target.value)} className="input-base" placeholder="ישראלי" />
        </div>
      </div>

      {/* Phone + Email */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>טלפון</label>
          <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className="input-base" dir="ltr" placeholder="050-0000000" />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>אימייל</label>
          <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input-base" dir="ltr" placeholder="name@example.com" />
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
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>נציג מכירות</label>
          <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} className="input-base">
            <option value="">— לא מוקצה —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>
            follow-up הבא
            {form.status === 'in_progress' && <span style={{ color: 'var(--success)', marginRight: '6px', fontSize: '10px' }}>אוטומטי 24 שע׳</span>}
          </label>
          <input type="date" value={form.next_followup} onChange={e => set('next_followup', e.target.value)} className="input-base" dir="ltr" />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>הערות</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} className="input-base resize-none" placeholder="מידע נוסף על הליד, מה ביקש, מה אמר..." />
      </div>

      {/* File attachments (only when editing existing lead) */}
      {lead && (
        <div>
          <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>
            <Paperclip size={11} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '4px' }} />
            קבצים מצורפים
          </label>
          <div style={{ border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', padding: '12px', background: 'var(--bg-sunken)' }}>
            {attachedFiles.length > 0 && (
              <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {attachedFiles.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '7px 10px' }}>
                    <FileText size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: '12px', color: 'var(--fg-1)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
                    {f.size && <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>{(f.size / 1024).toFixed(0)} KB</span>}
                    <button type="button" onClick={() => removeFile(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex' }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg" onChange={handleFileUpload} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingFile}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', fontSize: '12px', fontFamily: 'inherit', padding: 0 }}>
              {uploadingFile ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> מעלה...</> : <><Upload size={13} /> הוסף קובץ</>}
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: '13px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-border)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
        <button type="submit" disabled={loading} className="btn-primary" style={{ opacity: loading ? 0.6 : 1 }}>
          {loading ? 'שומר...' : lead ? 'שמור שינויים' : '+ הוסף ליד'}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-ghost">ביטול</button>
      </div>
    </form>
  )
}
