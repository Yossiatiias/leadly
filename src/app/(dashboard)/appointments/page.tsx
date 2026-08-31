'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, ChevronLeft, Plus, X, Clock, User, Check, XCircle, Printer, Mail, Trash2, Phone, Stethoscope, Calendar, CalendarCheck, Pencil, MessageCircle } from 'lucide-react'
import { TREATMENT_LABELS, TREATMENT_COLORS, type TreatmentType } from '@/types'
import { israelDateTime } from '@/lib/botAppointments'
import { AUTO_MANAGED_STATUSES } from '@/lib/botTags'
import { promoteLeadStatusIfAutoManaged } from '@/lib/leads'
import { useConfirm } from '@/hooks/useConfirm'

// "פורסם" מותר לקבוע אוטומטית רק מתוך הסטטוסים שהמערכת עצמה מנהלת לפני
// זה (new/contacted/in_progress) — לא מתוך published עצמו (כבר שם) ולא
// מתוך שום סטטוס ידני אחר. ראה AUTO_MANAGED_STATUSES ב-botTags.ts
const PROMOTABLE_TO_PUBLISHED = AUTO_MANAGED_STATUSES.filter(s => s !== 'published')

const T_LABELS = TREATMENT_LABELS as Record<string, string>
const T_COLORS = TREATMENT_COLORS as Record<string, string>

// ─── Types ────────────────────────────────────────────────────────────────────
interface Appointment {
  id: string
  business_id: string
  lead_id: string | null
  patient_name: string
  patient_phone: string | null
  treatment_type: string | null
  scheduled_at: string
  duration_minutes: number
  status: 'scheduled' | 'arrived' | 'no_show' | 'completed' | 'cancelled'
  notes: string | null
  created_at: string
  assigned_to: string | null
  assignee?: { id: string; full_name: string | null } | null
  lead?: { name: string; phone: string | null } | null
}

interface Lead {
  id: string
  name: string
  phone: string | null
  treatment_type: string | null
}

interface Employee {
  id: string
  full_name: string | null
}


const STATUS_CONFIG = {
  scheduled:  { label: 'מתוכנן',    color: '#3B82F6', bg: '#EFF6FF', icon: Clock },
  arrived:    { label: 'הגיע',      color: '#10B981', bg: '#ECFDF5', icon: Check },
  no_show:    { label: 'לא הגיע',  color: '#EF4444', bg: '#FEF2F2', icon: XCircle },
  completed:  { label: 'הושלם',    color: '#8B5CF6', bg: '#F5F3FF', icon: Check },
  cancelled:  { label: 'בוטל',     color: '#9CA3AF', bg: '#F9FAFB', icon: X },
}

// צבע ייחודי לכל איש צוות/רופא
const DOCTOR_PALETTE = [
  '#7C3AED', // סגול
  '#059669', // ירוק
  '#DC2626', // אדום
  '#D97706', // ענבר
  '#2563EB', // כחול
  '#DB2777', // ורוד
  '#0891B2', // ציאן
  '#65A30D', // לים
  '#EA580C', // כתום
  '#0D9488', // טורקיז
]

function doctorColor(assignedTo: string | null, employees: Employee[]): string {
  if (!assignedTo) return '#6B7280'
  const idx = employees.findIndex(e => e.id === assignedTo)
  return DOCTOR_PALETTE[idx >= 0 ? idx % DOCTOR_PALETTE.length : 0]
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8) // 8:00 – 19:00

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })
}
// DD.MM.YYYY — לתוך קובייה בודדת של תור, כדי שהתאריך יהיה גלוי גם כשלא
// מסתכלים על כותרת היום שמעל הרשימה (למשל אחרי מיון/גלילה)
function formatDateDMY(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}
function isSameDay(a: string, b: Date) {
  const d = new Date(a)
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate()
}
function weekStart(d: Date) {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0) // חובה לאפס את השעה — אחרת גבול תחילת השבוע נשאר
  // בשעה שבה currentDate נטען/נוגע לאחרונה (למשל 17:23), וכל תור מוקדם
  // יותר באותו יום ראשון (כמו 09:00) נופל בטעות מחוץ לטווח השבוע
  const day = s.getDay() // 0=ראשון … 6=שבת
  s.setDate(s.getDate() - day)
  return s
}

const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const HEB_DAYS_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// ─── Add Appointment Modal ────────────────────────────────────────────────────
function AddModal({
  businessId, leads, employees, defaultDate, editAppt, onClose, onSaved,
}: {
  businessId: string
  leads: Lead[]
  employees: Employee[]
  defaultDate: Date
  editAppt?: Appointment | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => {
    if (editAppt) {
      const d = new Date(editAppt.scheduled_at)
      return {
        patient_name:   editAppt.patient_name,
        patient_phone:  editAppt.patient_phone || '',
        lead_id:        editAppt.lead_id || '',
        treatment_type: editAppt.treatment_type || '',
        assigned_to:    editAppt.assigned_to || '',
        scheduled_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        scheduled_time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        duration:       String(editAppt.duration_minutes),
        notes:          editAppt.notes || '',
      }
    }
    return {
      patient_name:   '',
      patient_phone:  '',
      lead_id:        '',
      treatment_type: '',
      assigned_to:    '',
      scheduled_date: defaultDate.toISOString().slice(0, 10),
      scheduled_time: '09:00',
      duration:       '30',
      notes:          '',
    }
  })

  function set(k: string, v: string) {
    if (k === 'lead_id' && v) {
      const lead = leads.find(l => l.id === v)
      if (lead) {
        setForm(f => ({ ...f, lead_id: v, patient_name: lead.name, patient_phone: lead.phone || '', treatment_type: lead.treatment_type || f.treatment_type }))
        return
      }
    }
    setForm(f => ({ ...f, [k]: v }))
  }

  async function save() {
    if (!form.patient_name || !form.scheduled_date || !form.scheduled_time) {
      setError('שם מטופל, תאריך ושעה הם שדות חובה')
      return
    }
    // חשוב: לפרש את התאריך/שעה כשעון ישראל תמיד — לא לפי אזור הזמן של
    // המחשב שממנו הטופס נשלח. אחרת תור שנקבע ידנית ממחשב שאזור הזמן שלו
    // לא מוגדר לישראל (כמו תור שנקבע ע"י הבוט) יישמר בשעה שגויה בלי שום אזהרה.
    const israelDt = israelDateTime(form.scheduled_date, form.scheduled_time)
    if (!israelDt) {
      setError('תאריך או שעה לא תקינים')
      return
    }
    setSaving(true)
    const scheduled_at = israelDt.toISOString()
    const durationMs   = (parseInt(form.duration) || 30) * 60000
    const end_at       = new Date(israelDt.getTime() + durationMs).toISOString()

    const payload = {
      lead_id:        form.lead_id || null,
      patient_name:   form.patient_name,
      patient_phone:  form.patient_phone || null,
      treatment_type: form.treatment_type || null,
      assigned_to:    form.assigned_to || null,
      scheduled_at,
      duration_minutes: parseInt(form.duration) || 30,
      notes:          form.notes || null,
    }

    const { error: err } = editAppt
      ? await supabase.from('appointments').update(payload).eq('id', editAppt.id)
      : await supabase.from('appointments').insert({ ...payload, business_id: businessId, status: 'scheduled' })
    if (err) { setError(err.message); setSaving(false); return }

    // קרה בפועל (30/08): זה עדכן status ישירות בלי לבדוק בכלל מה הסטטוס
    // הנוכחי — תור חדש שנקבע ידנית ללקוח ב-quote_followup דרס אותו בחזרה
    // ל-published בשקט. עכשיו מוגן ע"י אותה בדיקה בדיוק כמו בכל מקום אחר
    if (!editAppt && form.lead_id) {
      await promoteLeadStatusIfAutoManaged(supabase, form.lead_id, 'published', PROMOTABLE_TO_PUBLISHED)
    }

    // Push to Google Calendar (silently — don't block on failure); new appointments only
    if (!editAppt) fetch('/api/calendar/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: businessId,
        title: form.patient_name + (form.treatment_type ? ` — ${T_LABELS[form.treatment_type]}` : ''),
        start: scheduled_at,
        end:   end_at,
        notes: form.notes || undefined,
      }),
    }).catch(() => {})

    onSaved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '500px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        direction: 'rtl',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>{editAppt ? 'עריכת תור' : 'תור חדש'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Lead selector */}
          <div>
            <label style={lbl}>מטופל קיים (אופציונלי)</label>
            <select value={form.lead_id} onChange={e => set('lead_id', e.target.value)} className="input-base">
              <option value="">— מטופל חדש / ללא ליד —</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.name}{l.phone ? ` · ${l.phone}` : ''}</option>)}
            </select>
          </div>

          <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={lbl}>שם מטופל *</label>
              <input value={form.patient_name} onChange={e => set('patient_name', e.target.value)} placeholder="שם מלא" className="input-base" />
            </div>
            <div>
              <label style={lbl}>טלפון</label>
              <input value={form.patient_phone} onChange={e => set('patient_phone', e.target.value)} dir="ltr" placeholder="050-0000000" className="input-base" />
            </div>
          </div>

          <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={lbl}>סיבת הפנייה</label>
              <select value={form.treatment_type} onChange={e => set('treatment_type', e.target.value)} className="input-base">
                <option value="">— ללא —</option>
                {form.treatment_type && !T_LABELS[form.treatment_type] && (
                  <option value={form.treatment_type}>{form.treatment_type}</option>
                )}
                {Object.entries(T_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {employees.length > 0 && (
              <div>
                <label style={lbl}>רופא / מטפל</label>
                <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} className="input-base">
                  <option value="">— לא שויך —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || 'ללא שם'}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px' }}>
            <div>
              <label style={lbl}>תאריך *</label>
              <input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} className="input-base" dir="ltr" />
            </div>
            <div>
              <label style={lbl}>שעה *</label>
              <input type="time" value={form.scheduled_time} onChange={e => set('scheduled_time', e.target.value)} className="input-base" dir="ltr" />
            </div>
            <div>
              <label style={lbl}>משך (דקות)</label>
              <select value={form.duration} onChange={e => set('duration', e.target.value)} className="input-base">
                {[15, 30, 45, 60, 90, 120].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={lbl}>הערות</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="input-base" style={{ resize: 'none' }} placeholder="הנחיות מיוחדות, אנמנזה רלוונטית..." />
          </div>
        </div>

        {error && <p style={{ color: '#EF4444', fontSize: '12px', marginTop: '10px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn-ghost">ביטול</button>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }}>
            {saving ? 'שומר...' : editAppt ? 'שמור שינויים' : '+ הוסף תור'}
          </button>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }

// ─── Appointment Card ─────────────────────────────────────────────────────────
function ApptCard({ appt, employees, onStatusChange, onDelete, confirm, highlighted }: {
  appt: Appointment; employees: Employee[];
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string, leadId: string | null) => Promise<boolean>
  confirm: (message: string) => Promise<boolean>
  highlighted?: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const cfg = STATUS_CONFIG[appt.status]
  const dColor = doctorColor(appt.assigned_to, employees)
  const tLabel = appt.treatment_type ? (T_LABELS[appt.treatment_type] || appt.treatment_type) : ''
  const cardRef = useRef<HTMLDivElement>(null)

  // מעבר מהיר מדף הלידים — גלילה אוטומטית למיקום הטבעי של התור ברשימה
  // (לא מזיזים אותו לראש הרשימה, רק גוללים אליו וממורכזים אותו במסך).
  // בטוח עכשיו: סרגל התאריך למעלה קבוע (sticky, תוקן בשורש ב-layout.tsx
  // ב-25/08) ולכן לא בורח מהמסך יחד עם הגלילה כמו שקרה קודם
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlighted])

  async function handleDelete() {
    if (!(await confirm('האם למחוק את התור?'))) return
    setDeleting(true)
    const ok = await onDelete(appt.id, appt.lead_id)
    if (!ok) setDeleting(false)
  }

  return (
    <div ref={cardRef} style={{
      background: highlighted ? 'var(--brand-soft)' : 'var(--bg-surface)', borderRadius: '12px', padding: '14px 16px',
      border: highlighted ? '1.5px solid var(--brand)' : '1px solid var(--border-subtle)', borderRight: `3px solid ${dColor}`,
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <User size={13} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--fg-1)' }}>{appt.patient_name}</span>
            {tLabel && (
              <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '5px', background: `${dColor}18`, color: dColor, border: `1px solid ${dColor}30`, fontWeight: 600 }}>
                {tLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--fg-3)' }}>
              <Clock size={11} /> {formatDateDMY(appt.scheduled_at)} · {formatTime(appt.scheduled_at)} · {appt.duration_minutes} דקות
            </span>
            {appt.patient_phone && (
              <a href={`tel:${appt.patient_phone}`} style={{ fontSize: '12px', color: 'var(--fg-3)', textDecoration: 'none' }}>{appt.patient_phone}</a>
            )}
            {appt.assignee?.full_name && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: dColor, fontWeight: 600, background: `${dColor}14`, padding: '1px 7px', borderRadius: '5px', border: `1px solid ${dColor}40` }}>
                👨‍⚕️ {appt.assignee.full_name}
              </span>
            )}
          </div>
          {appt.notes && <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '4px 0 0' }}>{appt.notes}</p>}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          <select
            value={appt.status}
            onChange={e => onStatusChange(appt.id, e.target.value)}
            style={{
              fontSize: '11px', fontWeight: 600, padding: '4px 8px', borderRadius: '8px',
              border: `1.5px solid ${cfg.color}30`, background: cfg.bg, color: cfg.color,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="מחיקת תור"
            style={{
              background: 'none', border: 'none', cursor: deleting ? 'not-allowed' : 'pointer',
              color: 'var(--fg-4)', padding: '4px', display: 'flex', borderRadius: '6px',
              transition: 'color 0.15s', opacity: deleting ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (!deleting) (e.currentTarget.style.color = '#EF4444') }}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-4)')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Appt Detail Popup ────────────────────────────────────────────────────────
function PopupField({ icon: Icon, label, value, ltr }: {
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>
  label: string; value: string | null | undefined; ltr?: boolean
}) {
  return (
    <div>
      <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--fg-4)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon size={14} style={{ flexShrink: 0 }} /> {label}
      </p>
      <p style={{ margin: 0, fontSize: '15px', color: 'var(--fg-1)', fontWeight: 600 }} dir={ltr ? 'ltr' : undefined}>
        {value || '—'}
      </p>
    </div>
  )
}

function ApptDetailPopup({ appt, employees, onClose, onDelete, onEdit, confirm }: {
  appt: Appointment; employees: Employee[];
  onClose: () => void
  onDelete: (id: string, leadId: string | null) => Promise<boolean>
  onEdit: (appt: Appointment) => void
  confirm: (message: string) => Promise<boolean>
}) {
  const [deleting, setDeleting] = useState(false)
  const tLabel = appt.treatment_type ? (T_LABELS[appt.treatment_type] || appt.treatment_type) : null
  const statusCfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.scheduled

  async function handleDelete() {
    if (!(await confirm('האם למחוק את התור?'))) return
    setDeleting(true)
    const ok = await onDelete(appt.id, appt.lead_id)
    if (ok) { onClose() } else { setDeleting(false) }
  }

  const dt = new Date(appt.scheduled_at)
  const totalEnd = dt.getHours() * 60 + dt.getMinutes() + appt.duration_minutes
  const timeRange = `${formatTime(appt.scheduled_at)} – ${String(Math.floor(totalEnd / 60)).padStart(2,'0')}:${String(totalEnd % 60).padStart(2,'0')}`

  const outlineBtn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
    padding: '10px 18px', borderRadius: '10px',
    border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
    color: 'var(--fg-1)', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: '20px', width: '420px', maxWidth: '92vw',
        direction: 'rtl', padding: '24px 28px',
        boxShadow: '0 24px 70px rgba(0,0,0,0.25)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <CalendarCheck size={20} style={{ color: 'var(--brand)' }} />
            <span style={{ fontSize: '17px', fontWeight: 700, color: 'var(--fg-1)' }}>פרטי התור</span>
          </div>
          <button onClick={onClose} disabled={deleting} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)',
            padding: '4px', display: 'flex',
          }}><X size={18} /></button>
        </div>

        {/* Info grid — 2 columns like the reference */}
        <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px' }}>
          <PopupField icon={User} label="שם המטופל" value={appt.patient_name} />
          <PopupField icon={Phone} label="טלפון" value={appt.patient_phone} ltr />
          <PopupField icon={CalendarCheck} label="סיבת הפנייה" value={tLabel} />
          <PopupField icon={Stethoscope} label="רופא" value={appt.assignee?.full_name} />
          <PopupField icon={Calendar} label="תאריך התור" value={formatDate(appt.scheduled_at)} />
          <PopupField icon={Clock} label="שעת התור" value={timeRange} ltr />
        </div>

        {/* Status */}
        <div style={{ marginTop: '20px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--fg-4)', fontWeight: 500 }}>סטטוס</p>
          <span style={{
            display: 'inline-block', fontSize: '12px', fontWeight: 700,
            padding: '4px 14px', borderRadius: '8px',
            background: statusCfg.bg, color: statusCfg.color,
          }}>{statusCfg.label}</span>
        </div>

        {appt.notes && (
          <div style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '10px', background: 'var(--bg-sunken)' }}>
            <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--fg-4)', fontWeight: 500 }}>הערות</p>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-2)' }}>{appt.notes}</p>
          </div>
        )}

        <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '20px 0 18px' }} />

        {/* Actions: ביטול תור | עריכת תור */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleDelete} disabled={deleting} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            padding: '10px 18px', borderRadius: '10px', border: 'none',
            background: '#E23E3E', color: 'white',
            fontFamily: 'inherit', fontSize: '13px', fontWeight: 700,
            cursor: deleting ? 'not-allowed' : 'pointer',
            opacity: deleting ? 0.6 : 1,
          }}>
            <XCircle size={15} /> {deleting ? 'מבטל...' : 'ביטול תור'}
          </button>
          <button onClick={() => onEdit(appt)} disabled={deleting} style={outlineBtn}>
            <Pencil size={14} /> עריכת תור
          </button>
        </div>
        {appt.lead_id && (
          <Link href={`/conversations?lead_id=${appt.lead_id}`} style={{
            ...outlineBtn, marginTop: '10px', width: '100%', boxSizing: 'border-box',
            textDecoration: 'none', background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-border)',
          }}>
            <MessageCircle size={14} /> שיחה
          </Link>
        )}
      </div>
    </div>
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({ appointments, week, employees, onAddAt, onDelete, onEdit, confirm }: {
  appointments: Appointment[]; week: Date[]; employees: Employee[];
  onAddAt: (d: Date) => void; onDelete: (id: string, leadId: string | null) => Promise<boolean>
  onEdit: (appt: Appointment) => void
  confirm: (message: string) => Promise<boolean>
}) {
  const now = new Date()
  const [selected, setSelected] = useState<Appointment | null>(null)

  return (
    <>
      {selected && (
        <ApptDetailPopup
          appt={selected} employees={employees}
          onClose={() => setSelected(null)}
          onDelete={onDelete}
          onEdit={a => { setSelected(null); onEdit(a) }}
          confirm={confirm}
        />
      )}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(7, 1fr)`, minWidth: '700px' }}>
          {/* Header */}
          <div style={{ borderBottom: '1px solid var(--border-default)' }} />
          {week.map((day, i) => {
            const isToday = isSameDay(day.toISOString(), now)
            return (
              <div key={i} style={{
                padding: '10px 8px', textAlign: 'center',
                borderBottom: '1px solid var(--border-default)',
                borderRight: '1px solid var(--border-subtle)',
                background: isToday ? 'var(--brand-soft)' : 'transparent',
              }}>
                <p style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '0 0 2px' }}>{HEB_DAYS[i]}</p>
                <p style={{
                  fontSize: '16px', fontWeight: isToday ? 700 : 400,
                  color: isToday ? 'var(--brand)' : 'var(--fg-1)', margin: 0,
                }}>{day.getDate()}</p>
              </div>
            )
          })}

          {/* Hour rows */}
          {HOURS.map(h => (
            <>
              <div key={`h${h}`} style={{
                padding: '0 8px', height: '64px', display: 'flex', alignItems: 'flex-start', paddingTop: '4px',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{String(h).padStart(2, '0')}:00</span>
              </div>
              {week.map((day, di) => {
                const dayAppts = appointments.filter(a => {
                  const d = new Date(a.scheduled_at)
                  return isSameDay(a.scheduled_at, day) && d.getHours() === h
                })
                const isToday = isSameDay(day.toISOString(), now)
                return (
                  <div key={`${h}-${di}`} style={{
                    height: '64px', borderBottom: '1px solid var(--border-subtle)',
                    borderRight: '1px solid var(--border-subtle)', padding: '2px',
                    background: isToday ? 'var(--brand-soft)' : 'transparent',
                    cursor: 'pointer',
                  }}
                    onClick={() => { const d = new Date(day); d.setHours(h); onAddAt(d) }}>
                    {dayAppts.map(a => {
                      const dColor = doctorColor(a.assigned_to, employees)
                      return (
                        <div key={a.id}
                          onClick={e => { e.stopPropagation(); setSelected(a) }}
                          style={{
                            borderRight: `3px solid ${dColor}`,
                            background: `${dColor}12`,
                            borderRadius: '5px',
                            padding: '3px 5px 3px 3px',
                            margin: '1px 0',
                            cursor: 'pointer',
                            opacity: a.status === 'cancelled' ? 0.45 : 1,
                            transition: 'background 0.12s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = `${dColor}22`)}
                          onMouseLeave={e => (e.currentTarget.style.background = `${dColor}12`)}
                        >
                          <div style={{ fontSize: '10px', fontWeight: 400, color: dColor, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {formatTime(a.scheduled_at)} {a.patient_name}
                          </div>
                          {a.assignee?.full_name && (
                            <div style={{ fontSize: '9px', fontWeight: 400, color: 'var(--fg-3)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {a.assignee.full_name}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const supabase = createClient()
  const { confirm, ConfirmDialog } = useConfirm()
  const searchParams = useSearchParams()
  // מעבר מהיר מדף הלידים (?date=YYYY-MM-DD&highlight=<appointmentId>) —
  // לתאריך עצמו, בדיוק לפי מה שקיים באמת בטבלה כרגע (הכפתור בדף הלידים
  // נטען חי מ-appointments לפי טלפון, לא ממטמון/זיכרון)
  const highlightId = searchParams.get('highlight')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [view, setView] = useState<'week' | 'day' | 'list'>('week')
  const [currentDate, setCurrentDate] = useState(() => {
    const dateParam = searchParams.get('date')
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return new Date(`${dateParam}T00:00:00`)
    return new Date()
  })
  const [showAdd, setShowAdd] = useState(false)
  const [addDate, setAddDate] = useState(new Date())
  const [editAppt, setEditAppt] = useState<Appointment | null>(null)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')

  // תצוגת "שבועי" דורשת גלילה אופקית של לוח רחב — לא נוח כברירת מחדל
  // בטלפון. במסך צר פותחים ב"יומי" במקום; פעם אחת בעליית הדף בלבד,
  // לא דורס בחירה ידנית מאוחרת יותר של המשתמש.
  // אותו דבר גם במעבר מהיר עם highlight — "יומי" הוא התצוגה היחידה
  // שמציגה תור בודד בבירור, בלי צורך לחפש אותו בתוך לוח שבועי
  useEffect(() => {
    if (window.innerWidth <= 768 || highlightId) setView('day')
  }, [highlightId])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) { setLoading(false); return }
    const bId = profile.business_id
    setBusinessId(bId)

    const [{ data: appts }, { data: leadsData }, { data: empsData }] = await Promise.all([
      supabase.from('appointments').select('*, lead:leads(name, phone), assignee:profiles!assigned_to(id, full_name)').eq('business_id', bId).order('scheduled_at', { ascending: true }),
      supabase.from('leads').select('id, name, phone, treatment_type').eq('business_id', bId).is('deleted_at', null).order('name'),
      supabase.from('profiles').select('id, full_name').eq('business_id', bId).order('full_name'),
    ])
    setAppointments(appts || [])
    setLeads(leadsData || [])
    setEmployees(empsData || [])
    setLoading(false)

    // Retroactive sync: any lead with a booked appointment → status = published.
    // קרה בפועל (30/08, לימור וכו'): הרשימה הישנה חסמה רק 4 סטטוסים
    // (published/not_relevant/closed/lost) — כל סטטוס ידני אחר (quote_sent,
    // quote_followup, arrived, no_show...) לא היה מוגן, אז כל פתיחה של
    // עמוד היומן דרסה בשקט את הבחירה הידנית של הנציג בחזרה ל-published,
    // בלי שום קשר לבוט. אותו עיקרון בדיוק כמו STATUS_RANK ב-botTags.ts:
    // מתקדמים אוטומטית רק מתוך סטטוסים שהמערכת עצמה מנהלת
    // (PROMOTABLE_TO_PUBLISHED, נגזר מ-AUTO_MANAGED_STATUSES) — כל סטטוס
    // אחר, כולל כל סטטוס עתידי שעוד לא קיים, מוגן אוטומטית
    const leadIdsWithAppts = [...new Set(
      (appts || [])
        .filter(a => a.lead_id && !['cancelled', 'no_show'].includes(a.status))
        .map(a => a.lead_id as string)
    )]
    if (leadIdsWithAppts.length > 0) {
      await supabase.from('leads')
        .update({ status: 'published' })
        .in('id', leadIdsWithAppts)
        .in('status', PROMOTABLE_TO_PUBLISHED)
    }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('appointments').update({ status }).eq('id', id)
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: status as Appointment['status'] } : a))
  }

  async function deleteAppt(appointmentId: string, leadId: string | null): Promise<boolean> {
    const { error } = await supabase.from('appointments').delete().eq('id', appointmentId)
    if (error) {
      alert('שגיאה במחיקת התור: ' + error.message)
      return false
    }

    setAppointments(prev => prev.filter(a => a.id !== appointmentId))

    if (leadId) {
      // If lead has no other active appointments, revert status from published → in_progress.
      // קרה בפועל (30/08): זה עדכן status ישירות בלי לבדוק מה הסטטוס
      // הנוכחי — מחיקת תור ישן/כפול ללקוח ב-closed/quote_followup/lost
      // וכו' דרסה אותו בחזרה ל-in_progress בשקט. מוגן עכשיו: מבצע את
      // ההיפוך רק אם הסטטוס הנוכחי הוא **בדיוק** published — זו התופעה
      // היחידה שהאוטומציה הזו אמורה לבטל, לא שום סטטוס ידני אחר
      const remaining = appointments.filter(a =>
        a.id !== appointmentId &&
        a.lead_id === leadId &&
        !['cancelled', 'no_show'].includes(a.status)
      )
      if (remaining.length === 0) {
        await promoteLeadStatusIfAutoManaged(supabase, leadId, 'in_progress', ['published'])
      }
    }

    return true
  }

  // Week days
  const weekDays = useMemo(() => {
    const start = weekStart(currentDate)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [currentDate])

  // Base filter by employee
  const filteredAppts = useMemo(() =>
    filterEmployee ? appointments.filter(a => a.assigned_to === filterEmployee) : appointments
  , [appointments, filterEmployee])

  // Day appointments
  const dayAppts = useMemo(() =>
    filteredAppts.filter(a => isSameDay(a.scheduled_at, currentDate))
      .filter(a => !selectedStatus || a.status === selectedStatus)
  , [filteredAppts, currentDate, selectedStatus])

  // List (upcoming)
  const listAppts = useMemo(() => {
    const now = new Date()
    return filteredAppts
      .filter(a => new Date(a.scheduled_at) >= now)
      .filter(a => !selectedStatus || a.status === selectedStatus)
      .slice(0, 20)
  }, [filteredAppts, selectedStatus])

  // Week appointments — weekDays[6] הוא תחילת יום שבת (00:00), לא סופו,
  // אז הגבול העליון חייב לכלול את כל יום שבת עד חצות
  const weekAppts = useMemo(() => {
    const weekEnd = new Date(weekDays[6])
    weekEnd.setHours(23, 59, 59, 999)
    return filteredAppts.filter(a => {
      const d = new Date(a.scheduled_at)
      return d >= weekDays[0] && d <= weekEnd
    })
  }, [filteredAppts, weekDays])

  // Stats
  const today = new Date()
  const todayAppts = appointments.filter(a => isSameDay(a.scheduled_at, today))
  const pending = appointments.filter(a => a.status === 'scheduled' && new Date(a.scheduled_at) >= today)

  function navigate(dir: number) {
    const d = new Date(currentDate)
    if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir)
    setCurrentDate(d)
  }

  function monthLabel() {
    if (view === 'week') {
      const s = weekDays[0]
      const e = weekDays[6]
      if (s.getMonth() === e.getMonth())
        return `${s.toLocaleDateString('he-IL', { month: 'long' })} ${s.getFullYear()}`
      return `${s.toLocaleDateString('he-IL', { month: 'short' })} – ${e.toLocaleDateString('he-IL', { month: 'long' })} ${e.getFullYear()}`
    }
    if (view === 'day')
      return currentDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return 'תורים קרובים'
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <p style={{ color: 'var(--fg-4)' }}>טוען יומן...</p>
    </div>
  )

  return (
    <div style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto', direction: 'rtl' }}>

      {/* Stats bar */}
      <div className="grid-2col-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'תורים היום',   value: todayAppts.length,                                          color: '#3B82F6' },
          { label: 'ממתינים',      value: pending.length,                                             color: '#F59E0B' },
          { label: 'הגיעו היום',   value: todayAppts.filter(a => a.status === 'arrived').length,      color: '#10B981' },
          { label: 'לא הגיעו היום', value: todayAppts.filter(a => a.status === 'no_show').length,    color: '#EF4444' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 4px' }}>{s.label}</p>
            <p style={{ fontSize: '28px', fontWeight: 300, color: s.color, margin: 0, lineHeight: 1 }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Header controls — sticky: כל סרגל הפקדים (חדש/הדפסה/מייל, מסננים,
          ניווט תאריך, שבועי/יומי/רשימה) חייב להישאר גלוי גם כשגוללים למטה
          ברשימת התורים. תוקן בשורש (25/08) ב-layout.tsx: main.dashboard-main
          היה מוגדר עם overflow-y:auto בלי height קבוע (רק minHeight) — הגלילה
          האמיתית תמיד קרתה במסמך, אבל overflow שאינו visible עדיין הופך כל
          אב-טופס ל"scroll container" לפי ה-spec, מה שניתק את ה-sticky כאן
          מהגלילה האמיתית. אחרי הסרת overflow-y מ-main, ה-sticky הזה נחשב
          סוף-סוף יחסית לגלילת המסמך האמיתית — בדיוק מה שהיה חסר */}
      <div className="card flex-wrap-mobile" style={{ padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-sunken)', padding: '3px', borderRadius: '10px' }}>
          {(['week', 'day', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '6px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '12px', fontWeight: view === v ? 600 : 400,
              background: view === v ? 'var(--bg-surface)' : 'transparent',
              color: view === v ? 'var(--fg-1)' : 'var(--fg-3)',
              boxShadow: view === v ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}>
              {v === 'week' ? 'שבועי' : v === 'day' ? 'יומי' : 'רשימה'}
            </button>
          ))}
        </div>

        {/* Navigation */}
        {view !== 'list' && (
          <>
            <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
              <ChevronRight size={18} />
            </button>
            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)', minWidth: '130px', textAlign: 'center', whiteSpace: 'nowrap' }}>{monthLabel()}</span>
            <button onClick={() => navigate(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setCurrentDate(new Date())} style={{
              fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-default)',
              background: 'none', cursor: 'pointer', color: 'var(--fg-3)', fontFamily: 'inherit',
            }}>היום</button>
          </>
        )}

        {/* Employee filter */}
        {employees.length > 0 && (
          <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="input-base" style={{ fontSize: '12px', paddingTop: '6px', paddingBottom: '6px', minWidth: '130px' }}>
            <option value="">כל הצוות</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || 'ללא שם'}</option>)}
          </select>
        )}

        {/* Status filter */}
        <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className="input-base" style={{ fontSize: '12px', paddingTop: '6px', paddingBottom: '6px', minWidth: '120px', marginRight: 'auto' }}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>

        {/* Print + email */}
        <button onClick={() => window.print()} style={{
          display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px',
          borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
          color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          <Printer size={12} /> הדפסה
        </button>
        <button onClick={() => {
          const lines = (view === 'list' ? listAppts : view === 'day' ? dayAppts : weekAppts)
            .map(a => `${formatDate(a.scheduled_at)} ${formatTime(a.scheduled_at)} — ${a.patient_name}${a.treatment_type ? ` (${T_LABELS[a.treatment_type] || a.treatment_type})` : ''}`)
            .join('%0A')
          window.location.href = `mailto:?subject=תורים&body=${lines}`
        }} style={{
          display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px',
          borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
          color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          <Mail size={12} /> שלח במייל
        </button>

        {/* Add button */}
        <button onClick={() => { setAddDate(currentDate); setShowAdd(true) }} style={{
          display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px',
          borderRadius: '10px', border: 'none', background: 'var(--brand)', color: 'white',
          fontFamily: 'inherit', fontWeight: 600, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          <Plus size={13} /> תור חדש
        </button>
      </div>

      {/* Content */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Doctor legend */}
        {employees.length > 0 && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600 }}>צוות:</span>
            {employees.map((e, i) => (
              <span key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--fg-2)', fontWeight: 500 }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: DOCTOR_PALETTE[i % DOCTOR_PALETTE.length], flexShrink: 0 }} />
                {e.full_name || 'ללא שם'}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--fg-4)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6B7280', flexShrink: 0 }} />
              לא שויך
            </span>
          </div>
        )}

        {view === 'week' && (
          <WeekView appointments={weekAppts} week={weekDays} employees={employees} onAddAt={d => { setAddDate(d); setShowAdd(true) }} onDelete={(id, leadId) => deleteAppt(id, leadId)} onEdit={a => setEditAppt(a)} confirm={confirm} />
        )}

        {view === 'day' && (
          <div style={{ padding: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--fg-3)', marginBottom: '16px' }}>
              {dayAppts.length === 0 ? 'אין תורים ביום זה' : `${dayAppts.length} תורים`}
            </p>
            {dayAppts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <p style={{ fontSize: '36px', margin: '0 0 12px' }}>📅</p>
                <p style={{ color: 'var(--fg-3)', fontSize: '14px', fontWeight: 500 }}>אין תורים ביום זה</p>
                <button onClick={() => { setAddDate(currentDate); setShowAdd(true) }} style={{
                  marginTop: '12px', padding: '8px 18px', borderRadius: '10px', border: 'none',
                  background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer',
                }}>+ הוסף תור</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {dayAppts.map(a => <ApptCard key={a.id} appt={a} employees={employees} onStatusChange={updateStatus} onDelete={deleteAppt} confirm={confirm} highlighted={a.id === highlightId} />)}
              </div>
            )}
          </div>
        )}

        {view === 'list' && (
          <div style={{ padding: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--fg-3)', marginBottom: '16px' }}>
              תורים קרובים — {listAppts.length} נמצאו
            </p>
            {listAppts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <p style={{ fontSize: '36px', margin: '0 0 12px' }}>📋</p>
                <p style={{ color: 'var(--fg-3)', fontSize: '14px' }}>אין תורים קרובים</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {listAppts.map(a => (
                  <div key={a.id}>
                    <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600, margin: '8px 0 4px', textTransform: 'uppercase' }}>
                      {formatDate(a.scheduled_at)}
                    </p>
                    <ApptCard appt={a} employees={employees} onStatusChange={updateStatus} onDelete={deleteAppt} confirm={confirm} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && businessId && (
        <AddModal
          businessId={businessId}
          leads={leads}
          employees={employees}
          defaultDate={addDate}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadAll() }}
        />
      )}

      {/* Edit modal */}
      {editAppt && businessId && (
        <AddModal
          businessId={businessId}
          leads={leads}
          employees={employees}
          defaultDate={new Date(editAppt.scheduled_at)}
          editAppt={editAppt}
          onClose={() => setEditAppt(null)}
          onSaved={() => { setEditAppt(null); loadAll() }}
        />
      )}
      {ConfirmDialog}
    </div>
  )
}
