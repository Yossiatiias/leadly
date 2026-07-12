'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronRight, ChevronLeft, Plus, X, Clock, User, Check, XCircle, Printer, Mail } from 'lucide-react'
import { TREATMENT_LABELS, TREATMENT_COLORS, type TreatmentType } from '@/types'

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
  lead?: { name: string; phone: string | null } | null
}

interface Lead {
  id: string
  name: string
  phone: string | null
  treatment_type: string | null
}

const STATUS_CONFIG = {
  scheduled:  { label: 'מתוכנן',    color: '#3B82F6', bg: '#EFF6FF', icon: Clock },
  arrived:    { label: 'הגיע',      color: '#10B981', bg: '#ECFDF5', icon: Check },
  no_show:    { label: 'לא הגיע',  color: '#EF4444', bg: '#FEF2F2', icon: XCircle },
  completed:  { label: 'הושלם',    color: '#8B5CF6', bg: '#F5F3FF', icon: Check },
  cancelled:  { label: 'בוטל',     color: '#9CA3AF', bg: '#F9FAFB', icon: X },
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8) // 8:00 – 19:00

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })
}
function isSameDay(a: string, b: Date) {
  const d = new Date(a)
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate()
}
function weekStart(d: Date) {
  const s = new Date(d)
  const day = s.getDay()
  s.setDate(s.getDate() - ((day + 1) % 7))
  return s
}

const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const HEB_DAYS_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// ─── Add Appointment Modal ────────────────────────────────────────────────────
function AddModal({
  businessId, leads, defaultDate, onClose, onSaved,
}: {
  businessId: string
  leads: Lead[]
  defaultDate: Date
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    patient_name:   '',
    patient_phone:  '',
    lead_id:        '',
    treatment_type: '',
    scheduled_date: defaultDate.toISOString().slice(0, 10),
    scheduled_time: '09:00',
    duration:       '30',
    notes:          '',
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
    setSaving(true)
    const scheduled_at = new Date(`${form.scheduled_date}T${form.scheduled_time}:00`).toISOString()
    const { error: err } = await supabase.from('appointments').insert({
      business_id:    businessId,
      lead_id:        form.lead_id || null,
      patient_name:   form.patient_name,
      patient_phone:  form.patient_phone || null,
      treatment_type: form.treatment_type || null,
      scheduled_at,
      duration_minutes: parseInt(form.duration) || 30,
      status:         'scheduled',
      notes:          form.notes || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
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
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>תור חדש</h2>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={lbl}>שם מטופל *</label>
              <input value={form.patient_name} onChange={e => set('patient_name', e.target.value)} placeholder="שם מלא" className="input-base" />
            </div>
            <div>
              <label style={lbl}>טלפון</label>
              <input value={form.patient_phone} onChange={e => set('patient_phone', e.target.value)} dir="ltr" placeholder="050-0000000" className="input-base" />
            </div>
          </div>

          <div>
            <label style={lbl}>סוג טיפול</label>
            <select value={form.treatment_type} onChange={e => set('treatment_type', e.target.value)} className="input-base">
              <option value="">— ללא —</option>
              {Object.entries(T_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px' }}>
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
            {saving ? 'שומר...' : '+ הוסף תור'}
          </button>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }

// ─── Appointment Card ─────────────────────────────────────────────────────────
function ApptCard({ appt, onStatusChange }: { appt: Appointment; onStatusChange: (id: string, status: string) => void }) {
  const cfg = STATUS_CONFIG[appt.status]
  const tColor = appt.treatment_type ? T_COLORS[appt.treatment_type] : '#9CA3AF'
  const tLabel = appt.treatment_type ? T_LABELS[appt.treatment_type] : ''

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px 16px',
      border: `1px solid var(--border-subtle)`, borderRight: `3px solid ${tColor}`,
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <User size={13} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--fg-1)' }}>{appt.patient_name}</span>
            {tLabel && (
              <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '5px', background: `${tColor}18`, color: tColor, border: `1px solid ${tColor}30`, fontWeight: 600 }}>
                {tLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--fg-3)' }}>
              <Clock size={11} /> {formatTime(appt.scheduled_at)} · {appt.duration_minutes} דקות
            </span>
            {appt.patient_phone && (
              <a href={`tel:${appt.patient_phone}`} style={{ fontSize: '12px', color: 'var(--fg-3)', textDecoration: 'none' }}>{appt.patient_phone}</a>
            )}
          </div>
          {appt.notes && <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '4px 0 0' }}>{appt.notes}</p>}
        </div>
        {/* Status selector */}
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
      </div>
    </div>
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────
function WeekView({ appointments, week, onAddAt }: { appointments: Appointment[]; week: Date[]; onAddAt: (d: Date) => void }) {
  const now = new Date()

  return (
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
                  cursor: 'pointer', position: 'relative',
                }}
                  onClick={() => { const d = new Date(day); d.setHours(h); onAddAt(d) }}>
                  {dayAppts.map(a => {
                    const color = a.treatment_type ? T_COLORS[a.treatment_type] : '#3B82F6'
                    const cfg = STATUS_CONFIG[a.status]
                    return (
                      <div key={a.id} style={{
                        background: color, color: 'white', borderRadius: '6px', padding: '2px 6px',
                        fontSize: '10px', fontWeight: 600, margin: '1px', lineHeight: 1.4,
                        opacity: a.status === 'cancelled' ? 0.4 : 1,
                        border: `1px solid ${cfg.color}`,
                      }}>
                        {formatTime(a.scheduled_at)} {a.patient_name.split(' ')[0]}
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
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const supabase = createClient()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [view, setView] = useState<'week' | 'day' | 'list'>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [showAdd, setShowAdd] = useState(false)
  const [addDate, setAddDate] = useState(new Date())
  const [selectedStatus, setSelectedStatus] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    const bId = profile.business_id
    setBusinessId(bId)

    const [{ data: appts }, { data: leadsData }] = await Promise.all([
      supabase.from('appointments').select('*, lead:leads(name, phone)').eq('business_id', bId).order('scheduled_at', { ascending: true }),
      supabase.from('leads').select('id, name, phone, treatment_type').eq('business_id', bId).order('name'),
    ])
    setAppointments(appts || [])
    setLeads(leadsData || [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('appointments').update({ status }).eq('id', id)
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: status as Appointment['status'] } : a))
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

  // Day appointments
  const dayAppts = useMemo(() =>
    appointments.filter(a => isSameDay(a.scheduled_at, currentDate))
      .filter(a => !selectedStatus || a.status === selectedStatus)
  , [appointments, currentDate, selectedStatus])

  // List (upcoming)
  const listAppts = useMemo(() => {
    const now = new Date()
    return appointments
      .filter(a => new Date(a.scheduled_at) >= now)
      .filter(a => !selectedStatus || a.status === selectedStatus)
      .slice(0, 20)
  }, [appointments, selectedStatus])

  // Week appointments
  const weekAppts = useMemo(() =>
    appointments.filter(a => {
      const d = new Date(a.scheduled_at)
      return d >= weekDays[0] && d <= weekDays[6]
    })
  , [appointments, weekDays])

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
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

      {/* Header controls */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
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
            <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-1)', minWidth: '200px', textAlign: 'center' }}>{monthLabel()}</span>
            <button onClick={() => navigate(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-2)', padding: '4px' }}>
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setCurrentDate(new Date())} style={{
              fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-default)',
              background: 'none', cursor: 'pointer', color: 'var(--fg-3)', fontFamily: 'inherit',
            }}>היום</button>
          </>
        )}

        {/* Status filter */}
        <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className="input-base" style={{ fontSize: '12px', paddingTop: '6px', paddingBottom: '6px', minWidth: '120px', marginRight: 'auto' }}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>

        {/* Print + email */}
        <button onClick={() => window.print()} style={{
          display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
          borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
          color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer',
        }}>
          <Printer size={13} /> הדפסה
        </button>
        <button onClick={() => {
          const lines = (view === 'list' ? listAppts : view === 'day' ? dayAppts : weekAppts)
            .map(a => `${formatDate(a.scheduled_at)} ${formatTime(a.scheduled_at)} — ${a.patient_name}${a.treatment_type ? ` (${T_LABELS[a.treatment_type]})` : ''}`)
            .join('%0A')
          window.location.href = `mailto:?subject=תורים&body=${lines}`
        }} style={{
          display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px',
          borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
          color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer',
        }}>
          <Mail size={13} /> שלח במייל
        </button>

        {/* Add button */}
        <button onClick={() => { setAddDate(currentDate); setShowAdd(true) }} style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
          borderRadius: '10px', border: 'none', background: 'var(--brand)', color: 'white',
          fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
        }}>
          <Plus size={14} /> תור חדש
        </button>
      </div>

      {/* Content */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {view === 'week' && (
          <WeekView appointments={weekAppts} week={weekDays} onAddAt={d => { setAddDate(d); setShowAdd(true) }} />
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
                }}>
                  + הוסף תור
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {dayAppts.map(a => <ApptCard key={a.id} appt={a} onStatusChange={updateStatus} />)}
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
                    <ApptCard appt={a} onStatusChange={updateStatus} />
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
          defaultDate={addDate}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadAll() }}
        />
      )}
    </div>
  )
}
