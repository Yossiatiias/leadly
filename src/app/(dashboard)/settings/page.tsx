'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Check, Plus, X, Upload, Loader2, Trash2, Clock, AlertTriangle, ChevronDown, ChevronUp, Target } from 'lucide-react'
import ConnectionsPanel from '@/components/ConnectionsPanel'
import { useConfirm } from '@/hooks/useConfirm'

interface Service {
  name: string
  price: string
  duration: string
  notes: string
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

const TABS = ['כללי', 'שעות פעילות', 'בוט WhatsApp', 'שירותים', 'תורים', 'רופאים ונציגים', 'התראות מערכת', 'חיבורים'] as const
type Tab = typeof TABS[number]

// סוגי אירועים שאפשר לקבל עליהם התראה — מבנה שמאפשר להוסיף עוד סוגים
// בעתיד (לדוגמה: תור בוטל, תזכורת שהגיע מועדה) בלי לשנות את המסך
interface NotificationPref { email_enabled: boolean; email: string; whatsapp_enabled: boolean; whatsapp_number: string }
const NOTIFICATION_EVENTS: { key: string; label: string; description: string }[] = [
  { key: 'human_handoff', label: 'דרישה לנציג אנושי', description: 'כשהבוט מבטיח ללקוח שנציג יחזור אליו, ומפסיק לענות לו' },
]
const DEFAULT_NOTIFICATION_PREF: NotificationPref = { email_enabled: false, email: '', whatsapp_enabled: false, whatsapp_number: '' }

interface Employee {
  id: string
  full_name: string | null
  role: string | null
  email?: string | null
}

const DEFAULT_SCHEDULE: WorkingDay[] = [
  { day: 'ראשון',  open: '09:00', close: '17:00', closed: false },
  { day: 'שני',    open: '09:00', close: '17:00', closed: false },
  { day: 'שלישי', open: '09:00', close: '17:00', closed: false },
  { day: 'רביעי', open: '09:00', close: '17:00', closed: false },
  { day: 'חמישי', open: '09:00', close: '17:00', closed: false },
  { day: 'שישי',  open: '09:00', close: '13:00', closed: false },
  { day: 'שבת',   open: '',      close: '',      closed: true  },
]

// אותה פלטה בדיוק שכבר בשימוש ביומן המרפאה (doctorColor ב-appointments/page.tsx)
// — כדי שצבע העובד יהיה עקבי בין שני המסכים, לא צבע חדש שהומצא כאן
const EMPLOYEE_PALETTE = ['#7C3AED', '#059669', '#DC2626', '#D97706', '#2563EB', '#DB2777', '#0891B2', '#65A30D']
function employeeColor(index: number): string {
  return EMPLOYEE_PALETTE[index % EMPLOYEE_PALETTE.length]
}

// צבע התג של כל תפקיד — נגזר ממשתני הצבע הסמנטיים הקיימים של המערכת,
// לא מהמצאת פלטה חדשה
const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  admin:     { label: 'מנהל',        color: 'var(--info)',    bg: 'var(--info-soft)' },
  doctor:    { label: 'רופא',        color: 'var(--success)', bg: 'var(--success-soft)' },
  agent:     { label: 'נציג מכירות', color: 'var(--brand)',   bg: 'var(--brand-soft)' },
  reception: { label: 'קבלה',        color: 'var(--warning)', bg: 'var(--warning-soft)' },
}

export default function SettingsPage() {
  const supabase = createClient()
  const { confirm, ConfirmDialog } = useConfirm()
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [tab, setTab] = useState<Tab>('כללי')

  const [general, setGeneral] = useState({ name: '', industry: '', address: '', phone: '', email: '', website: '', logo_url: '' })
  const [hours, setHours] = useState<WorkingDay[]>(DEFAULT_HOURS)
  const [bot, setBot] = useState({ greeting: '', goal: 'appointment', escalation_rule: '', auto_reply_hours: '24', description: '' })
  const [services, setServices] = useState<Service[]>([])
  const [apptSettings, setApptSettings] = useState({ default_duration: '30', booking_window_days: '60' })
  const [employees, setEmployees] = useState<Employee[]>([])
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [deletingEmp, setDeletingEmp] = useState<string | null>(null)
  const [empSchedules, setEmpSchedules] = useState<Record<string, WorkingDay[]>>({})
  const [empResponsibilities, setEmpResponsibilities] = useState<Record<string, string[]>>({})
  const [empMinLeadHours, setEmpMinLeadHours] = useState<Record<string, number>>({})
  const [optimaDoctorCodes, setOptimaDoctorCodes] = useState<Record<string, string>>({})
  const [businessExceptions, setBusinessExceptions] = useState<{date: string; reason: string}[]>([])
  const [newException, setNewException] = useState<{date: string; reason: string}>({ date: '', reason: '' })
  const [followup, setFollowup] = useState({ enabled: false, hours: '2', message: 'שלום {{name}}, תודה על הביקור שלך ב-{{clinic}}! נשמח אם תשאיר לנו ביקורת קצרה 🙏' })
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'agent' })
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [notifications, setNotifications] = useState<Record<string, NotificationPref>>({})
  const [instructionsDoc, setInstructionsDoc] = useState<{ filename: string; chars: number } | null>(null)
  const [instrUploading, setInstrUploading] = useState(false)
  const [instrMsg, setInstrMsg] = useState('')

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    // הגעה מ-OAuth של גוגל קלנדר (?tab=connections) — פותח ישר בלשונית חיבורים
    if (new URLSearchParams(window.location.search).get('tab') === 'connections') {
      setTab('חיבורים')
    }
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) { setLoading(false); return }
    const { data } = await supabase.from('businesses').select('*').eq('id', profile.business_id).single()
    if (data) {
      setBusiness(data)
      const s = data.settings || {}
      setGeneral({ name: data.name || '', industry: data.industry || '', address: data.address || '', phone: s.phone || '', email: s.email || '', website: data.website || '', logo_url: s.logo_url || '' })
      setHours(s.working_hours_table || DEFAULT_HOURS)
      setBot({ greeting: s.greeting || '', goal: s.goal || 'appointment', escalation_rule: s.escalation_rule || '', auto_reply_hours: s.auto_reply_hours || '24', description: s.description || '' })
      setServices(s.services || [])
      setApptSettings({ default_duration: s.default_duration || '30', booking_window_days: s.booking_window_days || '60' })
      setEmpSchedules(s.employee_schedules || {})
      setEmpResponsibilities(s.employee_responsibilities || {})
      setEmpMinLeadHours(s.employee_min_lead_hours || {})
      setOptimaDoctorCodes(s.optima_doctor_codes || {})
      setBusinessExceptions(s.business_exceptions || [])
      setFollowup({
        enabled: s.followup_enabled || false,
        hours: s.followup_hours || '2',
        message: s.followup_message || 'שלום {{name}}, תודה על הביקור שלך ב-{{clinic}}! נשמח אם תשאיר לנו ביקורת קצרה 🙏',
      })
      setInstructionsDoc(s.agent_instructions_filename
        ? { filename: s.agent_instructions_filename, chars: (s.agent_instructions || '').length }
        : null)
      const savedNotifs = s.notifications || {}
      const mergedNotifs: Record<string, NotificationPref> = {}
      for (const ev of NOTIFICATION_EVENTS) mergedNotifs[ev.key] = { ...DEFAULT_NOTIFICATION_PREF, ...(savedNotifs[ev.key] || {}) }
      setNotifications(mergedNotifs)

      // Load employees (profiles linked to this business)
      const { data: empData } = await supabase.from('profiles').select('id, full_name, role, email').eq('business_id', profile.business_id)
      setEmployees(empData || [])
    }
    setLoading(false)
  }

  async function inviteEmployee() {
    if (!inviteForm.full_name.trim() || !business?.id) return
    setInviting(true); setInviteMsg('')
    const isManual = !inviteForm.email.trim()
    const url = isManual ? '/api/employees/add-manual' : '/api/employees/invite'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...inviteForm, business_id: business.id }),
    })
    const json = await res.json()
    setInviting(false)
    if (!json.ok) { setInviteMsg('שגיאה: ' + json.error) }
    else {
      setInviteMsg(isManual ? `${inviteForm.full_name} נוסף בהצלחה` : 'הזמנה נשלחה ל-' + inviteForm.email)
      setInviteForm({ email: '', full_name: '', role: 'agent' })
      await loadData()
      setTimeout(() => { setShowAddEmployee(false); setInviteMsg('') }, 1500)
    }
  }

  async function deleteEmployee(emp: Employee) {
    if (!(await confirm(`למחוק את ${emp.full_name || 'העובד'} לצמיתות? תורים ולידים ששויכו אליו/ה יישארו, רק השיוך יוסר.`))) return
    setDeletingEmp(emp.id)
    const res = await fetch('/api/employees/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: emp.id }),
    })
    const json = await res.json()
    setDeletingEmp(null)
    if (!json.ok) { alert('מחיקת העובד נכשלה: ' + json.error); return }
    setEmployees(prev => prev.filter(x => x.id !== emp.id))
    setEmpSchedules(prev => { const n = { ...prev }; delete n[emp.id]; return n })
    setEmpResponsibilities(prev => { const n = { ...prev }; delete n[emp.id]; return n })
    setEmpMinLeadHours(prev => { const n = { ...prev }; delete n[emp.id]; return n })
    setOptimaDoctorCodes(prev => { const n = { ...prev }; delete n[emp.id]; return n })
    setExpandedEmp(cur => cur === emp.id ? null : cur)
  }

  // סדר קנוני של הימים — הנתונים השמורים בפועל לעובד לא בהכרח באותו סדר
  // מערך כמו DEFAULT_SCHEDULE (קרה בפועל: תצוגה "מבולבלת" שלא הולכת א'→ש'),
  // אז לתצוגה תמיד ממיינים לפי הסדר הזה במקום לסמוך על סדר המערך הגולמי
  const DAY_ORDER = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  function sortedSchedule(schedule: WorkingDay[]): WorkingDay[] {
    return [...schedule].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
  }
  // קיצור יום תקני בעברית (א'-ש') — לא האות הראשונה של שם היום, כי זו
  // דו-משמעית בפועל: גם "ראשון" וגם "רביעי" מתחילים ב-ר, וגם "שני",
  // "שלישי", "שישי" ו"שבת" כולם מתחילים ב-ש
  const DAY_LETTER: Record<string, string> = { 'ראשון': 'א', 'שני': 'ב', 'שלישי': 'ג', 'רביעי': 'ד', 'חמישי': 'ה', 'שישי': 'ו', 'שבת': 'ש' }

  async function uploadInstructions(file: File) {
    if (!business?.id) return
    setInstrUploading(true); setInstrMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('business_id', business.id)
    const res = await fetch('/api/settings/upload-instructions', { method: 'POST', body: fd })
    const data = await res.json()
    setInstrUploading(false)
    if (data.ok) {
      setInstructionsDoc({ filename: data.filename, chars: data.chars })
      setInstrMsg('✓ המסמך נטען — הבוט ישען עליו מעכשיו')
    } else {
      setInstrMsg('שגיאה: ' + (data.error || 'העלאה נכשלה'))
    }
  }

  async function removeInstructions() {
    if (!business?.id) return
    if (!(await confirm('להסיר את מסמך ההנחיות? הבוט יחזור לפעול לפי ההגדרות הרגילות בלבד.'))) return
    const res = await fetch('/api/settings/upload-instructions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: business.id }),
    })
    const data = await res.json()
    if (data.ok) { setInstructionsDoc(null); setInstrMsg('המסמך הוסר') }
    else setInstrMsg('שגיאה בהסרה')
  }

  async function uploadLogo(file: File) {
    if (!business?.id) return
    setLogoUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('business_id', business.id)
    const res = await fetch('/api/settings/upload-logo', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.url) setGeneral(g => ({ ...g, logo_url: data.url }))
    setLogoUploading(false)
  }

  async function save() {
    if (!business) return
    setSaving(true)
    // Fetch fresh settings to preserve employee keys managed separately
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', business.id).single()
    const existing = biz?.settings || {}
    await supabase.from('businesses').update({
      name: general.name,
      industry: general.industry,
      address: general.address,
      website: general.website,
      settings: {
        ...existing,
        phone: general.phone,
        email: general.email,
        description: bot.description,
        working_hours_table: hours,
        greeting: bot.greeting,
        goal: bot.goal,
        escalation_rule: bot.escalation_rule,
        auto_reply_hours: bot.auto_reply_hours,
        logo_url: general.logo_url,
        services,
        default_duration: apptSettings.default_duration,
        booking_window_days: apptSettings.booking_window_days,
        business_exceptions: businessExceptions,
        followup_enabled: followup.enabled,
        followup_hours: followup.hours,
        followup_message: followup.message,
        employee_schedules: empSchedules,
        employee_responsibilities: empResponsibilities,
        employee_min_lead_hours: empMinLeadHours,
        optima_doctor_codes: optimaDoctorCodes,
        notifications,
      },
    }).eq('id', business.id)
    // שם/תפקיד של עובדים נשמרים בטבלת profiles, לא ב-settings — כפתור
    // השמירה האחד הזה שומר גם אותם, אין כפתור "שמור" נפרד לכל עובד
    await Promise.all(employees.map(emp =>
      supabase.from('profiles').update({ full_name: emp.full_name, role: emp.role }).eq('id', emp.id)
    ))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function updateHour(i: number, field: keyof WorkingDay, value: any) {
    setHours(h => h.map((d, idx) => idx === i ? { ...d, [field]: value } : d))
  }

  function addService() {
    setServices(s => [...s, { name: '', price: '', duration: '30', notes: '', active: true }])
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
    <div className="mobile-tight-padding" style={{ padding: '28px', maxWidth: '760px', margin: '0 auto', direction: 'rtl' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>הגדרות מרפאה</h1>
        <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginTop: '3px' }}>מידע זה מוזן לסוכן ה-AI ומשמש לניהול העסק</p>
      </div>

      {/* Tabs */}
      <div className="flex-wrap-mobile" style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-surface)', borderRadius: '10px', padding: '4px', border: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button key={t} className="tab-btn-mobile" onClick={() => setTab(t)} style={{
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
          <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
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
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>לוגו העסק</label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {/* Preview */}
                {general.logo_url ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={general.logo_url} alt="לוגו" style={{ height: '52px', width: 'auto', maxWidth: '120px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border-default)', padding: '4px', background: 'white' }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    <button onClick={() => setGeneral(g => ({ ...g, logo_url: '' }))}
                      style={{ position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: '#EF4444', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                      <X size={10} />
                    </button>
                  </div>
                ) : null}
                {/* Upload button */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--border-default)', cursor: logoUploading ? 'default' : 'pointer', color: 'var(--fg-3)', fontSize: '13px', fontWeight: 500, background: 'var(--bg-sunken)', transition: 'all 0.15s' }}>
                  {logoUploading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
                  {logoUploading ? 'מעלה...' : general.logo_url ? 'החלף לוגו' : 'העלה לוגו'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} disabled={logoUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
                </label>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '6px' }}>PNG, JPG או SVG — יוצג בסרגל הצד</p>
            </div>
          </div>
        </div>
      )}

      {/* ── שעות פעילות ── */}
      {tab === 'שעות פעילות' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>שעות פעילות</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* header */}
            <div className="day-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', paddingBottom: '6px', borderBottom: '1px solid var(--border-subtle)' }}>
              {['יום', 'פתיחה', 'סגירה', 'סגור'].map(h => (
                <span key={h} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', letterSpacing: '0.04em' }}>{h}</span>
              ))}
            </div>
            {hours.map((d, i) => (
              <div key={d.day} className="day-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 60px', gap: '8px', alignItems: 'center' }}>
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

        {/* Business exceptions */}
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px' }}>🚫 חריגי זמינות</h3>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 16px' }}>
            תאריכים שהעסק סגור לכולם — חגים, חופשות, אירועים. הבוט לא יציע תורים בתאריכים אלו.
          </p>

          {businessExceptions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
              {businessExceptions
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((ex, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FECACA' }}>
                  <span style={{ fontSize: '13px', color: '#991B1B', fontWeight: 600 }}>
                    {new Date(ex.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                  {ex.reason && <span style={{ fontSize: '12px', color: '#7F1D1D' }}>— {ex.reason}</span>}
                  <button onClick={() => setBusinessExceptions(prev => prev.filter((_, i) => i !== idx))}
                    style={{ marginRight: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', display: 'flex', alignItems: 'center' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="date" value={newException.date} onChange={e => setNewException(n => ({ ...n, date: e.target.value }))}
              style={{ ...inp, width: 'auto', padding: '8px 10px' }} dir="ltr" />
            <input value={newException.reason} onChange={e => setNewException(n => ({ ...n, reason: e.target.value }))}
              placeholder="תיאור — ראש השנה, יום כיפור, חופשת קיץ..." style={{ ...inp, flex: 1 }} />
            <button disabled={!newException.date} onClick={() => {
              if (!newException.date) return
              setBusinessExceptions(prev => [...prev, { date: newException.date, reason: newException.reason }])
              setNewException({ date: '', reason: '' })
            }} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: newException.date ? 'pointer' : 'not-allowed', opacity: newException.date ? 1 : 0.5, flexShrink: 0, whiteSpace: 'nowrap' }}>
              + הוסף
            </button>
          </div>
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
            {/* מסמך הנחיות לבוט */}
            <div style={{ border: '1px solid var(--border-default)', borderRadius: '12px', padding: '14px 16px', background: 'var(--bg-sunken)' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 3px' }}>📄 מסמך הנחיות מלא (System Prompt)</p>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 12px' }}>
                העלה מסמך Word / טקסט עם תהליך העבודה המלא של הבוט — זהות, טון, מחירון, סניפים, זרימת שיחה.
                הבוט ישען על המסמך הזה כבסיס הפרומפט שלו.
              </p>
              {instructionsDoc ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--brand)', background: 'var(--brand-soft)', padding: '5px 12px', borderRadius: '8px' }}>
                    📎 {instructionsDoc.filename}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{instructionsDoc.chars.toLocaleString()} תווים</span>
                  <label style={{ fontSize: '12px', color: 'var(--fg-2)', cursor: 'pointer', textDecoration: 'underline' }}>
                    החלף קובץ
                    <input type="file" accept=".docx,.txt,.md" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadInstructions(f); e.target.value = '' }} />
                  </label>
                  <button onClick={removeInstructions} style={{ fontSize: '12px', color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                    הסר
                  </button>
                </div>
              ) : (
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: '7px',
                  padding: '8px 16px', borderRadius: '9px', cursor: instrUploading ? 'wait' : 'pointer',
                  border: '1.5px dashed var(--border-default)', background: 'var(--bg-surface)',
                  fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)',
                }}>
                  {instrUploading ? 'מעלה...' : '⬆️ העלה מסמך (docx / txt / md)'}
                  <input type="file" accept=".docx,.txt,.md" style={{ display: 'none' }} disabled={instrUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadInstructions(f); e.target.value = '' }} />
                </label>
              )}
              {instrMsg && <p style={{ fontSize: '11px', margin: '8px 0 0', color: instrMsg.startsWith('שגיאה') ? '#DC2626' : 'var(--success)' }}>{instrMsg}</p>}
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

            {/* Follow-up after appointment */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>📲 שליחה אוטומטית אחרי תור</p>
                  <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '2px 0 0' }}>הודעת WhatsApp ללקוח אחרי הביקור — תודה, ביקורת Google וכו׳</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: followup.enabled ? 'var(--brand)' : 'var(--fg-4)' }}>{followup.enabled ? 'פעיל' : 'כבוי'}</span>
                  <div onClick={() => setFollowup(f => ({ ...f, enabled: !f.enabled }))} style={{ width: '40px', height: '22px', borderRadius: '11px', background: followup.enabled ? 'var(--brand)' : 'var(--border-default)', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: '3px', right: followup.enabled ? '3px' : '19px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'right 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                </div>
              </div>
              {followup.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ maxWidth: '200px' }}>
                    <label style={lbl}>שלח אחרי כמה שעות מסיום התור?</label>
                    <select value={followup.hours} onChange={e => setFollowup(f => ({ ...f, hours: e.target.value }))} style={inp}>
                      {['1','2','4','6','24'].map(h => <option key={h} value={h}>{h === '24' ? 'יום אחד' : `${h} שעות`}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>תבנית הודעה</label>
                    <textarea value={followup.message} onChange={e => setFollowup(f => ({ ...f, message: e.target.value }))} rows={3} style={{ ...inp, resize: 'vertical' }} />
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', margin: '4px 0 0' }}>משתנים: <code>{'{{name}}'}</code> — שם המטופל, <code>{'{{clinic}}'}</code> — שם העסק</p>
                  </div>
                </div>
              )}
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
            <>
            {/* טבלת שירותים — מחשב בלבד (6 עמודות קבועות, לא נכנס למסך צר) */}
            <div className="services-desktop-table" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 90px 90px 50px 30px', gap: '8px' }}>
                {['שם שירות', 'הערה לבוט (תתי-טיפולים, כינויים...)', 'מחיר (₪)', 'משך (דק׳)', 'פעיל', ''].map(h => (
                  <span key={h} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)' }}>{h}</span>
                ))}
              </div>
              {services.map((svc, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 90px 90px 50px 30px', gap: '8px', alignItems: 'center', background: 'var(--bg-sunken)', padding: '8px 10px', borderRadius: '8px' }}>
                  <input value={svc.name} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="טיפולים משמרים" style={{ ...inp, padding: '6px 10px', fontSize: '12px' }} />
                  <input value={svc.notes || ''} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                    placeholder="עקירה, טיפול שורש, סתימה..." style={{ ...inp, padding: '6px 10px', fontSize: '12px', color: 'var(--fg-3)' }} />
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

            {/* כרטיסי שירותים — מובייל בלבד */}
            <div className="services-mobile-cards" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {services.map((svc, i) => (
                <div key={i} style={{ background: 'var(--bg-sunken)', padding: '10px 12px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input value={svc.name} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      placeholder="שם שירות" style={{ ...inp, flex: 1, fontSize: '13px' }} />
                    <button onClick={() => setServices(s => s.filter((_, j) => j !== i))} style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', alignItems: 'center', flexShrink: 0,
                    }}><X size={16} /></button>
                  </div>
                  <input value={svc.notes || ''} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                    placeholder="הערה לבוט (תתי-טיפולים, כינויים...)" style={{ ...inp, fontSize: '12px', color: 'var(--fg-3)' }} />
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input value={svc.price} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                      placeholder="מחיר (₪)" style={{ ...inp, flex: 1, fontSize: '12px' }} />
                    <input value={svc.duration} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))}
                      placeholder="משך (דק׳)" style={{ ...inp, flex: 1, fontSize: '12px' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--fg-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={svc.active} onChange={e => setServices(s => s.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--brand)', cursor: 'pointer' }} />
                      פעיל
                    </label>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {/* ── עובדים ── */}
      {tab === 'רופאים ונציגים' && (
        <div style={sec}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>רופאים ונציגים</h3>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '4px' }}>
                נהלו את צוות המרפאה, התפקידים ושעות העבודה.
              </p>
            </div>
            <button onClick={() => setShowAddEmployee(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', border: 'none',
              background: showAddEmployee ? 'var(--bg-sunken)' : 'var(--brand)', color: showAddEmployee ? 'var(--fg-2)' : 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer', flexShrink: 0,
            }}>
              {showAddEmployee ? <><X size={14} /> סגור</> : <><Plus size={14} /> הוספת עובד</>}
            </button>
          </div>

          {/* Add employee — נפתח רק לפי דרישה, לא טופס קבוע בראש המסך */}
          {showAddEmployee && (
            <div style={{ background: 'var(--bg-sunken)', borderRadius: '12px', padding: '16px', marginBottom: '20px', border: '1px dashed var(--border-default)' }}>
              <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: inviteForm.role === 'doctor' ? '1fr 140px' : '1fr 1fr 140px', gap: '10px', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ ...lbl, marginBottom: '3px' }}>שם מלא *</label>
                  <input value={inviteForm.full_name} onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="ד&quot;ר כהן" style={inp} />
                </div>
                {inviteForm.role !== 'doctor' && (
                <div>
                  <label style={{ ...lbl, marginBottom: '3px' }}>אימייל <span style={{ fontWeight: 400, opacity: 0.6 }}>(לגישה למערכת)</span></label>
                  <input value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="employee@clinic.co.il" dir="ltr" style={inp} />
                </div>
                )}
                <div>
                  <label style={{ ...lbl, marginBottom: '3px' }}>תפקיד</label>
                  <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value, email: '' }))} style={inp}>
                    <option value="admin">מנהל</option>
                    <option value="agent">נציג מכירות</option>
                    <option value="doctor">רופא</option>
                    <option value="reception">קבלה</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                <button onClick={inviteEmployee} disabled={inviting || !inviteForm.full_name.trim()} style={{
                  padding: '8px 18px', borderRadius: '8px', border: 'none',
                  background: inviting ? 'var(--brand-soft)' : 'var(--brand)', color: inviting ? 'var(--brand)' : 'white',
                  fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
                  cursor: inviting || !inviteForm.full_name.trim() ? 'default' : 'pointer',
                }}>
                  {inviting ? 'מוסיף...' : inviteForm.email.trim() ? 'שלח הזמנה' : 'הוסף'}
                </button>
                {inviteMsg && (
                  <span style={{ fontSize: '12px', color: inviteMsg.startsWith('שגיאה') ? 'var(--danger)' : 'var(--success)', fontWeight: 500 }}>
                    {inviteMsg}
                  </span>
                )}
              </div>
            </div>
          )}

          {employees.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px', color: 'var(--fg-4)', fontSize: '13px', background: 'var(--bg-sunken)', borderRadius: '10px' }}>
              אין עובדים רשומים עדיין
            </div>
          ) : (
            <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {employees.map((emp, idx) => {
                const schedule = sortedSchedule(empSchedules[emp.id] || DEFAULT_SCHEDULE)
                const isExpanded = expandedEmp === emp.id
                const activeDays = schedule.filter(d => !d.closed)
                const hasNoHours = activeDays.length === 0
                const resp = empResponsibilities[emp.id] || []
                const color = employeeColor(idx)
                const roleMeta = ROLE_META[emp.role || 'agent'] || ROLE_META.agent
                return (
                  <div key={emp.id} style={{
                    background: 'var(--bg-sunken)', borderRadius: '12px', overflow: 'hidden',
                    border: `1.5px solid ${isExpanded ? 'var(--brand)' : 'var(--border-subtle)'}`,
                    transition: 'border-color 0.15s',
                  }}>
                    {/* Employee row — Grid קבוע (לא flex עם shrink) כדי שאף עמודה לא תדרוס
                        את השכנה שלה; כל המידע גלוי גם כשהכרטיס סגור, רק כלי העריכה מוסתרים */}
                    <div className="grid-stack-mobile" style={{
                      padding: '12px 16px', display: 'grid',
                      gridTemplateColumns: '38px minmax(100px,1fr) 120px minmax(0,1.2fr) auto',
                      gap: '12px', alignItems: 'center',
                    }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: `${color}1A`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                        {(emp.full_name || 'U').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>

                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {emp.full_name || 'ללא שם'}
                        </p>
                        {emp.email && !emp.email.includes('@noreply.betterlead.local') && (
                          <p dir="ltr" style={{ unicodeBidi: 'plaintext', fontSize: '11px', color: 'var(--fg-4)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {emp.email}
                          </p>
                        )}
                      </div>

                      {/* תפקיד — select צבעוני, ממורכז, לפי תפקיד */}
                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                        <select
                          value={emp.role || 'agent'}
                          onChange={e => {
                            const newRole = e.target.value
                            setEmployees(prev => prev.map(x => x.id === emp.id ? { ...x, role: newRole } : x))
                          }}
                          style={{
                            appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: '12px', fontWeight: 600, textAlign: 'center',
                            padding: '6px 24px 6px 10px', borderRadius: '99px', width: '100%',
                            background: roleMeta.bg, color: roleMeta.color,
                          }}
                        >
                          <option value="admin">מנהל</option>
                          <option value="agent">נציג מכירות</option>
                          <option value="doctor">רופא</option>
                          <option value="reception">קבלה</option>
                        </select>
                        <ChevronDown size={12} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: roleMeta.color, pointerEvents: 'none' }} />
                      </div>

                      {/* תקציר שעות עבודה — LTR כדי שהשעות/המקף לא יתהפכו בתוך RTL,
                          ותמיד ממוין א'→ש' בלי קשר לסדר הגולמי של הנתונים השמורים */}
                      <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                        {hasNoHours ? (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                            <AlertTriangle size={11} /> לא הוגדרו שעות
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', minWidth: 0 }}>
                            <Clock size={11} style={{ flexShrink: 0 }} />
                            <span dir="ltr" style={{ unicodeBidi: 'plaintext', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {activeDays.map(d => `${DAY_LETTER[d.day]}׳ ${d.open}–${d.close}`).join(' · ')}
                            </span>
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}
                      >
                        {isExpanded ? 'סגור' : 'עריכת פרטים'}
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </div>

                    {/* Expanded editor — inline מתחת לשורה, לא מודל */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)' }}>

                        <div style={{ padding: '14px 16px' }}>
                          <label style={{ ...lbl, marginBottom: '3px' }}>שם מלא</label>
                          <input value={emp.full_name || ''} onChange={e => setEmployees(prev => prev.map(x => x.id === emp.id ? { ...x, full_name: e.target.value } : x))} placeholder="שם הנציג" style={{ ...inp, maxWidth: '320px' }} />
                        </div>

                        {/* Working hours editor — עדכון לפי שם היום, לא לפי אינדקס במערך,
                            כדי שהתצוגה הממוינת לא "תבלבל" איזה יום בעצם עורכים */}
                        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Clock size={12} /> שעות עבודה
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 10px' }}>סמנו את הימים שבהם העובד עובד. רק בשעות הפתוחות ניתן לקבוע תורים.</p>
                          {schedule.map(d => (
                            <div key={d.day} className="emp-day-grid-mobile" style={{ display: 'grid', gridTemplateColumns: '20px 34px 1fr 1fr', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                              <label style={{ display: 'flex' }}>
                                <span style={{ display: 'none' }}>{d.day} עובד/ת</span>
                                <input
                                  type="checkbox" checked={!d.closed}
                                  onChange={e => setEmpSchedules(prev => ({ ...prev, [emp.id]: (prev[emp.id] || DEFAULT_SCHEDULE).map(x => x.day === d.day ? { ...x, closed: !e.target.checked } : x) }))}
                                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brand)' }}
                                />
                              </label>
                              <span style={{ fontSize: '12px', fontWeight: 500, color: d.closed ? 'var(--fg-4)' : 'var(--fg-1)' }}>{DAY_LETTER[d.day]}׳</span>
                              {d.closed ? (
                                <span style={{ fontSize: '11px', color: 'var(--fg-4)', gridColumn: 'span 2' }}>לא עובד</span>
                              ) : (
                                <div dir="ltr" style={{ display: 'contents' }}>
                                  <input type="time" value={d.open} onChange={e => setEmpSchedules(prev => ({ ...prev, [emp.id]: (prev[emp.id] || DEFAULT_SCHEDULE).map(x => x.day === d.day ? { ...x, open: e.target.value } : x) }))} style={{ ...inp, padding: '6px 8px', fontSize: '12px' }} />
                                  <input type="time" value={d.close} onChange={e => setEmpSchedules(prev => ({ ...prev, [emp.id]: (prev[emp.id] || DEFAULT_SCHEDULE).map(x => x.day === d.day ? { ...x, close: e.target.value } : x) }))} style={{ ...inp, padding: '6px 8px', fontSize: '12px' }} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* מינימום שעות מראש — לרופא/ה שצריך/ה זמן הכנה (למשל לראות
                            תיק/הפניה) לפני שמגיעים אליו/ה. 0/ברירת מחדל = בלי מגבלה */}
                        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Clock size={12} /> מינימום שעות מראש לתיאום תור
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 10px' }}>הבוט לא יציע/יקבע תור אצל העובד/ת הזה בפחות מהזמן הזה מראש.</p>
                          {(() => {
                            const current = empMinLeadHours[emp.id] || 0
                            const presets = [0, 12, 24, 48]
                            const isCustom = current !== 0 && !presets.includes(current)
                            return (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                                {[
                                  { label: 'ללא מגבלה', value: 0 },
                                  { label: '12 שעות', value: 12 },
                                  { label: '24 שעות', value: 24 },
                                  { label: '48 שעות', value: 48 },
                                ].map(opt => {
                                  const checked = current === opt.value
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => setEmpMinLeadHours(prev => ({ ...prev, [emp.id]: opt.value }))}
                                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '8px', border: `1.5px solid ${checked ? 'var(--brand)' : 'var(--border-default)'}`, background: checked ? 'var(--brand-soft)' : 'var(--bg-surface)', cursor: 'pointer', fontSize: '12px', fontWeight: checked ? 600 : 400, color: checked ? 'var(--brand)' : 'var(--fg-2)', transition: 'all 0.12s', fontFamily: 'inherit' }}
                                    >
                                      {checked && <Check size={11} />}
                                      {opt.label}
                                    </button>
                                  )
                                })}
                                <button
                                  type="button"
                                  onClick={() => setEmpMinLeadHours(prev => ({ ...prev, [emp.id]: prev[emp.id] && !presets.includes(prev[emp.id]) ? prev[emp.id] : 1 }))}
                                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '8px', border: `1.5px solid ${isCustom ? 'var(--brand)' : 'var(--border-default)'}`, background: isCustom ? 'var(--brand-soft)' : 'var(--bg-surface)', cursor: 'pointer', fontSize: '12px', fontWeight: isCustom ? 600 : 400, color: isCustom ? 'var(--brand)' : 'var(--fg-2)', transition: 'all 0.12s', fontFamily: 'inherit' }}
                                >
                                  {isCustom && <Check size={11} />}
                                  אחר
                                </button>
                                {isCustom && (
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={current}
                                    onChange={e => {
                                      const n = parseInt(e.target.value, 10)
                                      setEmpMinLeadHours(prev => ({ ...prev, [emp.id]: isNaN(n) || n < 0 ? 0 : n }))
                                    }}
                                    style={{ ...inp, width: '80px', padding: '5px 8px', fontSize: '12px' }}
                                  />
                                )}
                              </div>
                            )
                          })()}
                        </div>

                        {/* Responsibilities — based on active services */}
                        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Target size={12} /> תחומי אחריות
                          </p>
                          {services.filter(s => s.active && s.name).length === 0 ? (
                            <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: 0 }}>
                              הוסף שירותים בכרטיסיית <strong>שירותים</strong> כדי לשייך לעובד זה.
                            </p>
                          ) : (
                            <>
                              <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 10px' }}>סמן אילו שירותים העובד מבצע — הבוט יציע אותו רק עבור השירותים המסומנים.</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {services.filter(s => s.active && s.name).map(svc => {
                                  const checked = resp.includes(svc.name)
                                  return (
                                    <button
                                      key={svc.name}
                                      type="button"
                                      onClick={() => {
                                        setEmpResponsibilities(prev => {
                                          const cur = prev[emp.id] || []
                                          return { ...prev, [emp.id]: checked ? cur.filter(k => k !== svc.name) : [...cur, svc.name] }
                                        })
                                      }}
                                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '8px', border: `1.5px solid ${checked ? 'var(--brand)' : 'var(--border-default)'}`, background: checked ? 'var(--brand-soft)' : 'var(--bg-surface)', cursor: 'pointer', fontSize: '12px', fontWeight: checked ? 600 : 400, color: checked ? 'var(--brand)' : 'var(--fg-2)', transition: 'all 0.12s', fontFamily: 'inherit' }}
                                    >
                                      {checked && <Check size={11} />}
                                      {svc.name}
                                    </button>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>

                        {/* קוד רופא באופטימה — רלוונטי רק לרופאים, ורק אחרי שחיברו את אופטימה
                            בכרטיסיית "חיבורים". בלי הקוד הזה, תורים של הרופא הזה לא יישלחו
                            אוטומטית ליומן של אופטימה */}
                        {emp.role === 'doctor' && (
                          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                            <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 6px' }}>🗓 קוד רופא באופטימה</p>
                            <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 8px' }}>
                              הקוד (DoctorCode) של הרופא/ה הזה במערכת אופטימה — בלעדיו תורים שלו לא יסונכרנו לשם.
                            </p>
                            <input
                              value={optimaDoctorCodes[emp.id] || ''}
                              onChange={e => setOptimaDoctorCodes(prev => ({ ...prev, [emp.id]: e.target.value }))}
                              placeholder="למשל: 6"
                              dir="ltr"
                              style={{ ...inp, maxWidth: '160px' }}
                            />
                          </div>
                        )}

                        {/* מחיקת עובד — פעולה הרסנית, בסוף העריכה ובעיצוב אדום כמו
                            מחיקות אחרות במערכת (ליד/קובץ/תור) */}
                        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                          <button
                            onClick={() => deleteEmployee(emp)}
                            disabled={deletingEmp === emp.id}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontFamily: 'inherit', fontWeight: 600, fontSize: '12px', cursor: deletingEmp === emp.id ? 'default' : 'pointer', opacity: deletingEmp === emp.id ? 0.6 : 1 }}
                          >
                            <Trash2 size={13} /> {deletingEmp === emp.id ? 'מוחק...' : 'מחיקת עובד'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            </>
          )}
        </div>
      )}

      {/* ── תורים ── */}
      {tab === 'תורים' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 18px' }}>הגדרות תורים</h3>
          <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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

      {/* ── התראות מערכת ── */}
      {tab === 'התראות מערכת' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px' }}>התראות מערכת</h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', margin: '0 0 18px' }}>
            בחר אילו אירועים תרצה לקבל עליהם התראה, ולאן לשלוח אותה.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {NOTIFICATION_EVENTS.map(ev => {
              const pref = notifications[ev.key] || DEFAULT_NOTIFICATION_PREF
              const update = (patch: Partial<NotificationPref>) =>
                setNotifications(n => ({ ...n, [ev.key]: { ...(n[ev.key] || DEFAULT_NOTIFICATION_PREF), ...patch } }))
              return (
                <div key={ev.key} style={{ border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)' }}>{ev.label}</p>
                  <p style={{ margin: '0 0 14px', fontSize: '11px', color: 'var(--fg-4)' }}>{ev.description}</p>

                  <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--fg-2)', marginBottom: '7px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={pref.email_enabled} onChange={e => update({ email_enabled: e.target.checked })}
                          style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                        קבל התראה במייל
                      </label>
                      <input type="email" value={pref.email} onChange={e => update({ email: e.target.value })}
                        disabled={!pref.email_enabled} placeholder="you@example.com" dir="ltr"
                        style={{ ...inp, opacity: pref.email_enabled ? 1 : 0.5 }} />
                    </div>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--fg-2)', marginBottom: '7px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={pref.whatsapp_enabled} onChange={e => update({ whatsapp_enabled: e.target.checked })}
                          style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                        קבל התראה בוואטסאפ
                      </label>
                      <input type="tel" value={pref.whatsapp_number} onChange={e => update({ whatsapp_number: e.target.value })}
                        disabled={!pref.whatsapp_enabled} placeholder="050-0000000" dir="ltr"
                        style={{ ...inp, opacity: pref.whatsapp_enabled ? 1 : 0.5 }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '16px' }}>
            כרגע נשמרת רק ההעדפה — שליחת ההתראות בפועל תופעל בשלב הבא.
          </p>
        </div>
      )}

      {/* ── חיבורים ── */}
      {tab === 'חיבורים' && (
        <div style={sec}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px' }}>אינטגרציות</h3>
          <ConnectionsPanel />
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
      {ConfirmDialog}
    </div>
  )
}
