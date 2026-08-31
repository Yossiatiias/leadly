'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  STATUS_CONFIG, SOURCE_LABELS, SOURCE_COLORS, STATUS_LABELS, TREATMENT_LABELS, TREATMENT_COLORS,
  isNewLead, getDisplayName, getLeadNumber,
  type Lead, type LeadStatus, type LeadSource, type TreatmentType,
} from '@/types'
import { Search, X, ArrowUpDown, ListFilter, Trash2, Check, Pencil, MessageCircle, FileSpreadsheet, Calendar } from 'lucide-react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { QUICK_RANGES, quickRangeDates, dstr, type QuickRange } from '@/lib/quickDateRanges'
import LeadDetail from '@/components/LeadDetail'
import { useConfirm } from '@/hooks/useConfirm'

/* ─── helpers ─── */
function formatPhone(phone: string): string {
  if (!phone) return '—'
  const c = phone.replace(/\D/g, '')
  if (c.startsWith('972') && c.length >= 12) {
    const l = '0' + c.slice(3)
    return `${l.slice(0, 3)}-${l.slice(3, 6)}-${l.slice(6)}`
  }
  if (c.startsWith('0') && c.length === 10)
    return `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}`
  return phone
}

// תאריך התור בשעון ישראל, לפרמטר ה-URL של מעבר מהיר ליומן
function apptDateParam(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtRelative(d: string) {
  const ms = Date.now() - new Date(d).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `לפני ${mins} דק'`
  const h = Math.floor(mins / 60)
  if (h < 24) return `לפני ${h} שע'`
  const days = Math.floor(h / 24)
  if (days < 7) return `לפני ${days} ימים`
  return fmtDate(d)
}

/* מצב תזכורת של ליד:
   due = הגיע מועד התזכורת (או עבר) → הליד קופץ לראש הרשימה בסטטוס "תזכורת" */
// מחזיר dayLabel ו-timeStr בנפרד (לא מחרוזת מאוחדת) — מוצגים בתא הטבלה
// בשתי שורות נפרדות, כדי שהשעה לא תיחתך/תיעלם ויזואלית כשהעמודה צרה
// (קרה בפועל: תווית ארוכה כמו "07.08.2026 14:30" ב-nowrap בעמודה של 96px
// נחתכה ע"י overflow-x:hidden של מעטפת הטבלה — השעה "נבלעה")
function reminderState(d: string | null) {
  if (!d) return null
  const t = new Date(d).getTime()
  if (isNaN(t)) return null
  const now = Date.now()
  const due = t <= now
  const timeStr = new Date(d).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  if (due) return { due: true, dayLabel: fmtDate(d), timeStr, color: '#DC2626', bg: '#FEF2F2' }

  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - startOfToday) / 86400000)
  if (days === 0) return { due: false, dayLabel: 'היום', timeStr, color: '#D97706', bg: '#FFFBEB' }
  if (days === 1) return { due: false, dayLabel: 'מחר',  timeStr, color: '#7C3AED', bg: '#F5F3FF' }
  return { due: false, dayLabel: fmtDate(d), timeStr, color: '#2563EB', bg: '#EFF6FF' }
}

/* המרת timestamp לערך של <input type="datetime-local"> בשעון מקומי */
function toLocalInput(d: string | null): string {
  if (!d) return ''
  const x = new Date(d)
  if (isNaN(x.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`
}

/* ─── constants ─── */
const ALL_STATUSES = ['new','contacted','in_progress','published','not_relevant','no_show','arrived','quote_sent','quote_followup','closed','lost']
const ALL_SOURCES  = ['whatsapp','manual','backoffice','website','scrape','facebook','instagram','social','other']
const ALL_TREATS   = ['implant','restorative','veneers','whitening','orthodontics','checkup','other']

type SortKey      = 'created_at' | 'next_followup'
type FilterKey    = 'status' | 'source' | 'treatment_type' | 'assigned'

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  call: 'שיחת טלפון', whatsapp: 'וואטסאפ (ידני)', note: 'הערה', status_change: 'שינוי סטטוס',
}

const OUTCOME_LABELS: Record<string, string> = {
  interested: '✅ מעוניין', not_interested: '❌ לא מעוניין', follow_up: '🔄 לחזור', no_answer: '📵 לא ענה',
}

// צבע לפי סוג האינטראקציה — טוקנים קיימים של האתר, לא צבעים חדשים, כדי
// שיתאימו אוטומטית גם למצב כהה (אותה גישה כמו תגיות הסטטוס)
const INTERACTION_KIND_COLOR: Record<string, string> = {
  call: 'var(--success)', whatsapp: 'var(--info)', note: 'var(--fg-3)', status_change: 'var(--warning)',
  bot_message: 'var(--brand)', customer_message: 'var(--danger)',
}

const COL_FILTERS: Record<string, { key: FilterKey; opts: string[]; labels: Record<string,string> }> = {
  status:         { key: 'status',         opts: ALL_STATUSES, labels: STATUS_LABELS as Record<string,string> },
  treatment_type: { key: 'treatment_type', opts: ALL_TREATS,   labels: TREATMENT_LABELS as Record<string,string> },
  source:         { key: 'source',         opts: ALL_SOURCES,  labels: SOURCE_LABELS as Record<string,string> },
}

/* ─── styles ─── */
const TH: React.CSSProperties = {
  textAlign: 'right', padding: '9px 11px', fontSize: '10px',
  fontWeight: 600, color: 'var(--fg-3)', letterSpacing: '0.05em',
  textTransform: 'uppercase', whiteSpace: 'nowrap', userSelect: 'none',
  position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-sunken)',
  boxShadow: 'inset 0 -1px 0 var(--border-subtle)',
}
const TD: React.CSSProperties = { padding: '7px 10px', verticalAlign: 'middle', whiteSpace: 'nowrap' }

/* ─── component ─── */
export default function LeadsPage() {
  const supabase = createClient()
  const [leads, setLeads]         = useState<Lead[]>([])
  const [loading, setLoading]     = useState(true)
  const [profiles, setProfiles]   = useState<any[]>([])
  const [convPhones, setConvPhones] = useState<Set<string>>(new Set())
  const [search, setSearch]       = useState('')
  const [filters, setFilters]     = useState<Record<FilterKey, string>>({ status: '', source: '', treatment_type: '', assigned: '' })
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]   = useState(false)
  const [trashCount, setTrashCount] = useState(0)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd]     = useState('')
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>(null)
  const [lastInteractions, setLastInteractions] = useState<Record<string, { label: string; kind: string; detail: string; at: string }>>({})
  // כפתור מעבר מהיר ליומן — התור הקרוב ביותר בעתיד לכל ליד. נטען לפי
  // lead_id ישירות מ-appointments (מקור האמת האמיתי, לא מטמון) כדי
  // שהכפתור תמיד יצביע על התור המעודכן בפועל, כולל שינויים ידניים ביומן
  const [apptByLead, setApptByLead] = useState<Record<string, { id: string; scheduled_at: string }>>({})
  const [noAnswerLeads, setNoAnswerLeads] = useState<Set<string>>(new Set())
  const [escalatedLeads, setEscalatedLeads] = useState<Set<string>>(new Set())
  const [summarizingInteraction, setSummarizingInteraction] = useState<Set<string>>(new Set())
  const interactionQueueRef = useRef<Set<string>>(new Set())
  const [statusDropdown, setStatusDropdown] = useState<{ leadId: string; x: number; y: number } | null>(null)
  const [editingTreatment, setEditingTreatment] = useState<string | null>(null)
  const [treatmentVal, setTreatmentVal] = useState('')
  const [services, setServices]   = useState<{ name: string }[]>([])
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey]     = useState<SortKey>('created_at')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [colDropdown, setColDropdown] = useState<{ col: string; x: number; y: number } | null>(null)
  const [reminderFor, setReminderFor] = useState<Lead | null>(null)
  const [reminderVal, setReminderVal] = useState('')
  const [reminderReason, setReminderReason] = useState('')
  const [savingReminder, setSavingReminder] = useState(false)
  const [nowTick, setNowTick]     = useState(Date.now())
  const analysisStarted           = useRef(false)
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  // רענון תקופתי כדי שתזכורת שהגיע מועדה תקפוץ לראש הרשימה בלי ריענון ידני
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  function openReminder(lead: Lead) {
    setReminderFor(lead)
    setReminderVal(toLocalInput(lead.next_followup))
    setReminderReason('')
  }

  async function saveReminder(clear = false) {
    if (!reminderFor) return
    setSavingReminder(true)
    const value = clear || !reminderVal ? null : new Date(reminderVal).toISOString()
    const { error } = await supabase.from('leads').update({ next_followup: value }).eq('id', reminderFor.id)
    if (error) { setSavingReminder(false); alert('שמירת התזכורת נכשלה: ' + error.message); return }

    // אם ניתנה סיבה — נרשמת כאינטראקציה (lead_activities), כדי ש"אינטראקציה
    // אחרונה" בטבלה תמיד תראה למה בעצם צריך לחזור ללקוח, לא רק מתי
    const reason = reminderReason.trim()
    if (!clear && value && reason) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('lead_activities').insert({
          lead_id: reminderFor.id,
          user_id: user.id,
          type: 'note',
          action: 'תזכורת נקבעה',
          details: reason,
        })
      }
    }

    setSavingReminder(false)
    setLeads(ls => ls.map(l => l.id === reminderFor.id ? { ...l, next_followup: value } : l))
    setReminderFor(null)
  }

  const load = useCallback(async () => {
      const [{ data: l }, { data: p }, { data: c }, { data: acts }, { data: convs }] = await Promise.all([
        supabase.from('leads').select('*, profile:profiles!leads_assigned_to_fkey(full_name)').is('deleted_at', null).order('created_at', { ascending: false }),
        supabase.from('profiles').select('*'),
        supabase.from('conversations').select('contact_phone').not('contact_phone', 'is', null),
        supabase.from('lead_activities').select('lead_id, type, action, details, outcome, created_at').order('created_at', { ascending: false }),
        supabase.from('conversations').select('id, lead_id').not('lead_id', 'is', null),
      ])
      setLeads(l || [])
      setProfiles(p || [])
      supabase.from('leads').select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null)
        .then(({ count }) => setTrashCount(count || 0))
      setConvPhones(new Set((c || []).map((x: any) => x.contact_phone)))

      // תור עתידי קרוב ביותר לכל ליד — לכפתור מעבר מהיר ליומן. לפי טלפון
      // (patient_phone), לא lead_id — בדיוק כמו שתוקן בבוט (25/08): תור
      // שסונכרן מאופטימה יכול להיות בלי קישור ליד בכלל, וחיפוש לפי טלפון
      // הוא מקור האמת האמיתי מול היומן בפועל, כולל שינויים ידניים בו
      supabase.from('appointments').select('id, patient_phone, scheduled_at')
        .in('status', ['scheduled', 'confirmed'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .then(({ data: appts }) => {
          const byPhone: Record<string, { id: string; scheduled_at: string }> = {}
          for (const a of (appts || []) as { id: string; patient_phone: string | null; scheduled_at: string }[]) {
            if (a.patient_phone && !byPhone[a.patient_phone]) byPhone[a.patient_phone] = { id: a.id, scheduled_at: a.scheduled_at }
          }
          const byLead: Record<string, { id: string; scheduled_at: string }> = {}
          for (const lead of (l || []) as { id: string; phone: string | null }[]) {
            if (lead.phone && byPhone[lead.phone]) byLead[lead.id] = byPhone[lead.phone]
          }
          setApptByLead(byLead)
        })

      // רשימת השירותים המוגדרים בעסק — "סיבת פנייה" ידנית נבחרת רק מתוכה,
      // בדיוק כמו matchServiceReason בבוט (src/lib/botTags.ts), כדי שהערך
      // תמיד יהיה תואם לשירות אמיתי ולא טקסט חופשי שלא מתועד באף מקום
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
        if (profile?.business_id) {
          const { data: biz } = await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
          const svcs = ((biz?.settings as any)?.services || []).filter((s: any) => s.active !== false)
          setServices(svcs)
        }
      }

      // לידים ש"ממתין לנציג" חל עליהם — שני מקרים בלתי-תלויים: (1) הבוט
      // כבוי לשיחה (מצב ידני, ע"י נציג) או (2) הבוט העביר אסקלציה
      // (escalated_at) — אבל **ממשיך לענות** (לא מכבה את עצמו יותר, ראה
      // ai-respond/route.ts). אותה הגדרה בדיוק כמו מסך "שיחות"
      // (conversations/page.tsx), כדי ששני המסכים תמיד יראו אותו הדבר
      supabase.from('conversations').select('lead_id')
        .or('bot_enabled.eq.false,escalated_at.not.is.null')
        .not('lead_id', 'is', null)
        .then(({ data: esc }) => setEscalatedLeads(new Set((esc || []).map((e: any) => e.lead_id))))

      // ─── אינטראקציה אחרונה — ידנית (lead_activities) או שיחת בוט (messages) ──
      // acts כבר ממוין יורד לפי created_at, אז המופע הראשון לכל lead_id הוא האחרון
      const lastActivityByLead: Record<string, { label: string; kind: string; detail: string; at: string }> = {}
      for (const a of (acts || []) as { lead_id: string; type: string; action: string; details: string | null; outcome: string | null; created_at: string }[]) {
        if (!lastActivityByLead[a.lead_id]) {
          // עדיפות לתוצאה (מה קרה בפועל, למשל "לא ענה") + הערות חופשיות —
          // "action" לבד הוא רק "שיחה עם X", לא מספר כלום על מה שקרה בשיחה
          const outcomeLabel = a.outcome ? OUTCOME_LABELS[a.outcome] : null
          const detail = [outcomeLabel, a.details].filter(Boolean).join(' — ') || a.action || ''
          lastActivityByLead[a.lead_id] = { label: ACTIVITY_TYPE_LABELS[a.type] || 'אינטראקציה', kind: a.type, detail, at: a.created_at }
        }
      }

      const convByLead: Record<string, string> = {}
      for (const cv of (convs || []) as { id: string; lead_id: string }[]) convByLead[cv.lead_id] = cv.id
      const convIds = Object.values(convByLead)

      const merged = { ...lastActivityByLead }
      if (convIds.length > 0) {
        const { data: msgs } = await supabase.from('messages')
          .select('conversation_id, content, direction, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
          .limit(3000)
        const lastMsgByConv: Record<string, { content: string; direction: string; created_at: string }> = {}
        for (const m of (msgs || []) as { conversation_id: string; content: string; direction: string; created_at: string }[]) {
          if (!lastMsgByConv[m.conversation_id]) lastMsgByConv[m.conversation_id] = m
        }
        // "אין מענה" — הבוט שלח הודעה אחרונה בשיחה והלקוח לא הגיב מעל 6 שעות.
        // מבוסס רק על שרשור הוואטסאפ עצמו (לא lead_activities) — זו בדיוק
        // השאלה "האם הלקוח ענה לנו", לא "האם תיעדנו משהו על הליד"
        const NO_ANSWER_THRESHOLD_MS = 6 * 3600 * 1000
        const noAnswer = new Set<string>()
        for (const [leadId, convId] of Object.entries(convByLead)) {
          const lastMsg = lastMsgByConv[convId]
          if (!lastMsg) continue
          const existing = merged[leadId]
          if (!existing || new Date(lastMsg.created_at) > new Date(existing.at)) {
            merged[leadId] = {
              label: lastMsg.direction === 'inbound' ? 'הודעה מהלקוח' : 'שיחת בוט',
              kind: lastMsg.direction === 'inbound' ? 'customer_message' : 'bot_message',
              detail: lastMsg.content || '',
              at: lastMsg.created_at,
            }
          }
          if (lastMsg.direction === 'outbound' && Date.now() - new Date(lastMsg.created_at).getTime() > NO_ANSWER_THRESHOLD_MS) {
            noAnswer.add(leadId)
          }
        }
        setNoAnswerLeads(noAnswer)
      }
      setLastInteractions(merged)

      setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // סגירת חלון כרטיס הליד הקופץ במקש Escape
  useEffect(() => {
    if (!openLeadId) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpenLeadId(null); load() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [openLeadId, load])

  // Close column dropdown on outside click
  useEffect(() => {
    if (!colDropdown) return
    const handler = () => setColDropdown(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [colDropdown])

  // Close status-change dropdown on outside click
  useEffect(() => {
    if (!statusDropdown) return
    const handler = () => setStatusDropdown(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [statusDropdown])

  // Auto-analyze leads without AI data, one by one in background
  useEffect(() => {
    if (loading || analysisStarted.current) return
    const unanalyzed = leads.filter(l => !l.ai_summary)
    if (unanalyzed.length === 0) return
    analysisStarted.current = true
    async function runSequential() {
      for (const lead of unanalyzed) {
        await analyzeAI(lead.id)
        await new Promise(r => setTimeout(r, 400))
      }
    }
    runSequential()
  }, [loading])

  const markOpened = useCallback(async (id: string) => {
    await supabase.from('leads').update({ first_opened_at: new Date().toISOString() }).eq('id', id).is('first_opened_at', null)
    setLeads(prev => prev.map(l => l.id === id && !l.first_opened_at ? { ...l, first_opened_at: new Date().toISOString() } : l))
  }, [supabase])

  async function analyzeAI(leadId: string) {
    setAnalyzing(prev => new Set([...prev, leadId]))
    try {
      const res = await fetch('/api/leads/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const data = await res.json()
      if (data.summary || data.recommendation) {
        setLeads(prev => prev.map(l =>
          l.id === leadId ? { ...l, ai_summary: data.summary, ai_recommendation: data.recommendation } : l
        ))
      }
    } finally {
      setAnalyzing(prev => { const s = new Set(prev); s.delete(leadId); return s })
    }
  }

  async function summarizeInteraction(leadId: string, text: string, at: string) {
    setSummarizingInteraction(prev => new Set([...prev, leadId]))
    try {
      const res = await fetch('/api/leads/summarize-interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, text, at }),
      })
      const data = await res.json()
      if (data.summary) {
        setLeads(prev => prev.map(l =>
          l.id === leadId ? { ...l, last_interaction_summary: data.summary, last_interaction_summarized_at: at } : l
        ))
      }
    } finally {
      setSummarizingInteraction(prev => { const s = new Set(prev); s.delete(leadId); return s })
    }
  }

  // מסכם ב-AI רק אינטראקציות ארוכות (מעל 80 תווים) שעדיין לא סוכמו, או
  // שהתעדכנו מאז הסיכום האחרון — אחת בכל פעם, כדי לא להציף את OpenAI
  useEffect(() => {
    if (loading) return
    const candidates = leads.filter(l => {
      const li = lastInteractions[l.id]
      if (!li || li.detail.length <= 80) return false
      if (interactionQueueRef.current.has(l.id)) return false
      const stale = !l.last_interaction_summary || !l.last_interaction_summarized_at
        || new Date(l.last_interaction_summarized_at) < new Date(li.at)
      return stale
    })
    if (candidates.length === 0) return
    candidates.forEach(c => interactionQueueRef.current.add(c.id))
    async function runSequential() {
      for (const lead of candidates) {
        const li = lastInteractions[lead.id]
        await summarizeInteraction(lead.id, li.detail, li.at)
        await new Promise(r => setTimeout(r, 400))
      }
    }
    runSequential()
  }, [loading, lastInteractions, leads])

  function openColFilter(e: React.MouseEvent, col: string) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setColDropdown(prev => prev?.col === col ? null : { col, x: rect.left, y: rect.bottom + 6 })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return leads
      .filter(l => {
        const name = getDisplayName(l)
        const matchQ = !q || name.toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.notes || '').toLowerCase().includes(q)
        const createdDay = dstr(new Date(l.created_at))
        const matchDate = (!dateStart || createdDay >= dateStart) && (!dateEnd || createdDay <= dateEnd)
        return matchQ && matchDate
          && (!filters.status || l.status === filters.status)
          && (!filters.source || l.source === filters.source)
          && (!filters.assigned || l.assigned_to === filters.assigned)
          && (!filters.treatment_type || l.treatment_type === filters.treatment_type)
      })
      .sort((a, b) => {
        // ליד שממתין לנציג אנושי (הבוט הבטיח והפסיק לענות) — הכי דחוף מהכל,
        // תמיד בראש הרשימה. אחריו תזכורות שהגיע מועדן
        const aEsc = escalatedLeads.has(a.id)
        const bEsc = escalatedLeads.has(b.id)
        if (aEsc !== bEsc) return aEsc ? -1 : 1

        const aDue = a.next_followup ? new Date(a.next_followup).getTime() <= nowTick : false
        const bDue = b.next_followup ? new Date(b.next_followup).getTime() <= nowTick : false
        if (aDue !== bDue) return aDue ? -1 : 1
        if (aDue && bDue) {
          return new Date(a.next_followup!).getTime() - new Date(b.next_followup!).getTime()
        }
        const av = a[sortKey] || '', bv = b[sortKey] || ''
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [leads, search, filters, sortKey, sortDir, nowTick, dateStart, dateEnd, escalatedLeads])

  const dueCount = useMemo(
    () => leads.filter(l => l.next_followup && new Date(l.next_followup).getTime() <= nowTick).length,
    [leads, nowTick]
  )

  function applyQuickRange(key: QuickRange) {
    if (activeQuickRange === key) { setActiveQuickRange(null); setDateStart(''); setDateEnd(''); return }
    const { start, end } = quickRangeDates(key)
    setActiveQuickRange(key)
    setDateStart(start)
    setDateEnd(end)
  }

  function clearDateRange() {
    setActiveQuickRange(null)
    setDateStart('')
    setDateEnd('')
  }

  // עדכון סטטוס ישירות מהטבלה — בלי לצאת לכרטיסיית הליד
  // מנקה את "ממתין לנציג" על השיחה של הליד ומדליק את הבוט אם היה כבוי —
  // דגל נפרד לגמרי מהתזכורת, שיושב על conversations לא על leads. מחפש
  // לפי bot_enabled=false **או** escalated_at קיים (שני המקרים הנפרדים
  // שגורמים ל"ממתין לנציג" — ראה load() למעלה)
  async function clearEscalation(leadId: string) {
    const { data: conv } = await supabase
      .from('conversations').select('id').eq('lead_id', leadId)
      .or('bot_enabled.eq.false,escalated_at.not.is.null').maybeSingle()
    if (!conv) return
    await supabase.from('conversations')
      .update({ bot_enabled: true, status: 'active', escalated_at: null, escalation_reason: null })
      .eq('id', conv.id)
    setEscalatedLeads(prev => { const n = new Set(prev); n.delete(leadId); return n })
  }

  async function changeStatus(leadId: string, status: LeadStatus) {
    setStatusDropdown(null)
    // ליד "פורסם" (תור נקבע) או "לא רלוונטי" לא צריך תזכורת פתוחה שגוררת
    // מפעם קודמת — אותה הבחנה שכבר קיימת בכרטיס הליד עצמו
    const clearReminder = status === 'published' || status === 'not_relevant'
    const update: { status: LeadStatus; next_followup?: null } = { status }
    if (clearReminder) update.next_followup = null
    const { error } = await supabase.from('leads').update(update).eq('id', leadId)
    if (error) { alert('עדכון הסטטוס נכשל: ' + error.message); return }
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...update } : l))
    // כל שינוי סטטוס ידני מנקה "ממתين לנציג" — לא רק פורסם/לא רלוונטי. ראה
    // שיחה עם יוסי (סרטון A67): לפני התיקון בחירה ידנית לא ניקתה כלום, אז
    // התג נשאר תקוע גם אחרי שהנציג בפירוש פעל
    await clearEscalation(leadId)
  }

  function startEditTreatment(lead: Lead) {
    setEditingTreatment(lead.id)
    setTreatmentVal(lead.treatment_type || '')
  }

  async function saveTreatment(leadId: string, explicitValue?: string) {
    const value = (explicitValue ?? treatmentVal).trim() || null
    setEditingTreatment(null)
    // treatment_type_locked=true: אחרי עריכה ידנית, הבוט לא ידרוס את זה יותר
    const { error } = await supabase.from('leads').update({ treatment_type: value, treatment_type_locked: true }).eq('id', leadId)
    if (error) { alert('שמירת סיבת הפנייה נכשלה: ' + error.message); return }
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, treatment_type: value as any, treatment_type_locked: true } : l))
  }

  const hasFilters  = Object.values(filters).some(Boolean) || !!dateStart || !!dateEnd
  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id))

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(filtered.map(l => l.id))) }
  function toggleOne(id: string) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  // מייצא בדיוק את מה שרואים כרגע בטבלה — כולל סינון/חיפוש פעיל, לפי אותו
  // סדר. בלי בחירת עמודות (לפי שיקול דעת) — אם יתברר שצריך גמישות, קל להוסיף
  function exportExcel() {
    const rows = filtered.map(l => ({
      "מס'": getLeadNumber(l),
      'שם פרטי': l.first_name || l.name || '',
      'שם משפחה': l.last_name || '',
      'טלפון': formatPhone(l.phone || ''),
      'סטטוס': STATUS_LABELS[l.status] || l.status,
      'סיבת פנייה': l.treatment_type || '',
      'מקור': SOURCE_LABELS[l.source] || l.source,
      'אינטראקציה אחרונה': lastInteractions[l.id]?.detail || '',
      'תזכורת': l.next_followup ? new Date(l.next_followup).toLocaleString('he-IL') : '',
      'נוצר': new Date(l.created_at).toLocaleDateString('he-IL'),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'לידים')
    XLSX.writeFile(wb, `leadly-leads-${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  // מעביר לידים נבחרים לסל מחזור — מחיקה רכה בלבד (deleted_at), לא נוגע
  // בקבצים/אינטראקציות שלהם, כדי ששחזור יחזיר הכל בדיוק כמו שהיה
  async function deleteSelected() {
    if (selected.size === 0) return
    if (!(await confirm(`להעביר ${selected.size} לידים לסל מחזור?`))) return
    setDeleting(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('leads').update({ deleted_at: new Date().toISOString() }).in('id', ids)
    setDeleting(false)
    if (error) { alert('המחיקה נכשלה: ' + error.message); return }
    setLeads(prev => prev.filter(l => !selected.has(l.id)))
    setSelected(new Set())
  }

  const dropdownMeta = colDropdown ? COL_FILTERS[colDropdown.col] : null

  // נתוני תצוגה מחושבים פעם אחת לכל ליד — משמשים גם את הטבלה (מחשב) וגם את
  // כרטיסי המובייל, כדי לא לשכפל את הלוגיקה בשני מקומות
  const NO_ANSWER_STATUSES = new Set(['new', 'contacted', 'in_progress'])

  const rows = useMemo(() => filtered.map(lead => {
    const status      = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new
    const isNew       = isNewLead(lead)
    const tColor      = lead.treatment_type ? TREATMENT_COLORS[lead.treatment_type as TreatmentType] : undefined
    const rem         = reminderState(lead.next_followup)
    const isDue       = !!rem?.due
    // ליד שממתין לנציג אנושי (ESCALATE מהבוט) — הכי דחוף, מנצח כל תצוגה אחרת
    const isEscalated = escalatedLeads.has(lead.id)
    // "אין מענה" — הבוט שלח הודעה אחרונה ואין תגובה מעל 6 שעות. תצוגה בלבד
    // (בדיוק כמו isDue), לא נוגע ב-status האמיתי ב-DB. רק בסטטוסים "פעילים",
    // ורק אם אין כבר תזכורת/אסקלציה דחופה יותר שמוצגת במקומו
    const isNoAnswer  = !isDue && !isEscalated && noAnswerLeads.has(lead.id) && NO_ANSWER_STATUSES.has(lead.status)
    const isSelected  = selected.has(lead.id)
    const isAnalyzing = analyzing.has(lead.id)
    return { lead, status, isNew, tColor, rem, isDue, isEscalated, isNoAnswer, isSelected, isAnalyzing }
  }), [filtered, selected, analyzing, noAnswerLeads, escalatedLeads])

  /* ─── small helper: filterable TH ─── */
  function FilterTH({ col, label, width }: { col: string; label: string; width?: string }) {
    const isActive = !!(filters as any)[COL_FILTERS[col]?.key]
    return (
      <th style={{ ...TH, width }} onClick={e => openColFilter(e, col)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          {label}
          <ListFilter size={10} style={{ color: isActive ? 'var(--brand)' : 'var(--fg-4)', flexShrink: 0 }} />
        </span>
      </th>
    )
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--brand)', opacity: 0.3, margin: '0 auto 10px', animation: 'pulse-soft 1.5s infinite' }} />
        <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען לידים...</p>
      </div>
    </div>
  )

  return (
    <div className="leads-page-scroll" style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', height: '100vh' }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '3px' }}>מאגר פונים</h1>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>
              {filtered.length} מוצגים{leads.length !== filtered.length ? ` מתוך ${leads.length}` : ''}
              {selected.size > 0 && ` · ${selected.size} נבחרו`}
            </span>
            {dueCount > 0 && (
              <span style={{
                background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5',
                borderRadius: '20px', padding: '2px 9px', fontSize: '11px', fontWeight: 700,
              }}>
                ⏰ {dueCount} {dueCount === 1 ? 'תזכורת' : 'תזכורות'} להיום
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportExcel} disabled={filtered.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'var(--bg-sunken)', color: 'var(--fg-2)', fontWeight: 600,
              padding: '9px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
              fontSize: '13px', cursor: filtered.length === 0 ? 'default' : 'pointer',
              opacity: filtered.length === 0 ? 0.5 : 1, fontFamily: 'inherit',
            }}>
            <FileSpreadsheet size={14} /> ייצוא לאקסל
          </button>
          <Link href="/leads/trash" style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--bg-sunken)', color: 'var(--fg-2)', fontWeight: 600,
            padding: '9px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
            fontSize: '13px', textDecoration: 'none', fontFamily: 'inherit',
          }}>
            <Trash2 size={14} /> סל מחזור
            {trashCount > 0 && (
              <span style={{ background: 'var(--danger)', color: 'white', fontSize: '10px', fontWeight: 700, borderRadius: '10px', padding: '1px 6px', lineHeight: 1.5 }}>
                {trashCount}
              </span>
            )}
          </Link>
          <Link href="/leads/new" style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--brand)', color: 'white', fontWeight: 600,
            padding: '9px 16px', borderRadius: 'var(--radius-md)', textDecoration: 'none',
            fontSize: '13px', boxShadow: '0 1px 4px rgba(43,107,232,0.25)',
          }}>
            + ליד חדש
          </Link>
        </div>
      </div>

      {/* ─── Search bar ─── */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-4)' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון, הערה..."
            className="input-base" style={{ paddingRight: '34px' }} />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex' }}>
              <X size={13} />
            </button>
          )}
        </div>
        {hasFilters && (
          <button onClick={() => { setFilters({ status: '', source: '', treatment_type: '', assigned: '' }); clearDateRange() }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 'var(--radius-md)', padding: '7px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
            <X size={11} /> נקה סינון ({Object.values(filters).filter(Boolean).length + (dateStart || dateEnd ? 1 : 0)})
          </button>
        )}
        {selected.size > 0 && (
          <button onClick={deleteSelected} disabled={deleting}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 'var(--radius-md)', padding: '7px 12px', fontSize: '12px', cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500, opacity: deleting ? 0.6 : 1 }}>
            <Trash2 size={12} /> {deleting ? 'מוחק...' : `מחק (${selected.size})`}
          </button>
        )}
      </div>

      {/* ─── סינון לפי תאריך פנייה ─── */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {QUICK_RANGES.map(r => (
          <button key={r.key} onClick={() => applyQuickRange(r.key)}
            style={{
              padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500,
              border: `1px solid ${activeQuickRange === r.key ? 'var(--brand)' : 'var(--border-default)'}`,
              background: activeQuickRange === r.key ? 'var(--brand-soft)' : 'var(--bg-sunken)',
              color: activeQuickRange === r.key ? 'var(--brand)' : 'var(--fg-2)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{r.label}</button>
        ))}
        <span style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', margin: '0 2px' }} />
        <label style={{ fontSize: '12px', color: 'var(--fg-4)' }}>מתאריך</label>
        <input type="date" value={dateStart}
          onChange={e => { setDateStart(e.target.value); setActiveQuickRange(null) }}
          className="input-base" style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }} />
        <label style={{ fontSize: '12px', color: 'var(--fg-4)' }}>עד תאריך</label>
        <input type="date" value={dateEnd}
          onChange={e => { setDateEnd(e.target.value); setActiveQuickRange(null) }}
          className="input-base" style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }} />
        {(dateStart || dateEnd) && (
          <button onClick={clearDateRange} style={{ display: 'flex', alignItems: 'center', color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={13} />
          </button>
        )}
      </div>

      {/* ─── Table — נפרסת על רוחב המסך, בלי גלילה לצדדים (מחשב בלבד) ─── */}
      <div className="card leads-table-wrap" style={{ overflowX: 'hidden', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ ...TH, width: '32px', paddingRight: '10px' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  style={{ width: '13px', height: '13px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
              </th>
              <th style={{ ...TH, width: '44px' }}>מס'</th>
              <th style={{ ...TH, width: '74px' }}>שם פרטי</th>
              <th style={{ ...TH, width: '74px' }}>שם משפחה</th>
              <th style={{ ...TH, width: '122px' }}>טלפון</th>
              <FilterTH col="status"         label="סטטוס"      width="122px" />
              <FilterTH col="treatment_type" label="סיבת פנייה" width="110px" />
              <FilterTH col="source"         label="מקור"        width="68px" />
              <th style={{ ...TH, width: '150px' }}>סיכום AI</th>
              <th style={{ ...TH, width: '150px' }}>אינטראקציה אחרונה</th>
              <th style={{ ...TH, width: '96px', cursor: 'pointer' }} onClick={() => toggleSort('next_followup')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  תזכורת <ArrowUpDown size={10} style={{ color: sortKey === 'next_followup' ? 'var(--brand)' : 'var(--fg-4)' }} />
                </span>
              </th>
              <th style={{ ...TH, width: '76px', cursor: 'pointer' }} onClick={() => toggleSort('created_at')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  נוצר <ArrowUpDown size={10} style={{ color: sortKey === 'created_at' ? 'var(--brand)' : 'var(--fg-4)' }} />
                </span>
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: '60px 0' }}>
                <Search size={30} style={{ color: 'var(--fg-4)', margin: '0 auto 10px', display: 'block' }} />
                <p style={{ color: 'var(--fg-3)', fontWeight: 500, fontSize: '14px' }}>לא נמצאו לידים</p>
                <p style={{ color: 'var(--fg-4)', fontSize: '12px', marginTop: '3px' }}>שנה את החיפוש או הסינון</p>
              </td></tr>
            )}

            {rows.map(({ lead, status, tColor, rem, isDue, isEscalated, isNoAnswer, isSelected, isAnalyzing }) => {
              const rowBg       = isSelected ? 'var(--brand-soft)' : (isEscalated || isDue) ? 'var(--danger-soft)' : undefined

              return (
                <tr key={lead.id}
                  onClick={() => { markOpened(lead.id); setOpenLeadId(lead.id) }}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: rowBg,
                    borderRight: (isEscalated || isDue) ? '3px solid var(--danger)' : '3px solid transparent',
                    transition: 'background 0.1s', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = rowBg || '' }}
                >
                  {/* ○ */}
                  <td style={{ ...TD, paddingRight: '14px', paddingTop: '13px', overflow: 'hidden', width: '32px', maxWidth: '32px' }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(lead.id)}
                      style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                  </td>

                  {/* מס' */}
                  <td style={{ ...TD, paddingTop: '13px', overflow: 'hidden', width: '44px', maxWidth: '44px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{getLeadNumber(lead)}</span>
                  </td>

                  {/* שם פרטי — width+overflow:hidden+textOverflow:ellipsis, כי זה שדה
                      טקסט חופשי (הוזן ע"י המשתמש) שיכול להיות ארוך במפתיע */}
                  <td style={{ ...TD, paddingTop: '12px', overflow: 'hidden', width: '74px', maxWidth: '74px' }}>
                    <span style={{ color: 'var(--fg-1)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                      {lead.first_name || lead.name || '—'}
                    </span>
                  </td>

                  {/* שם משפחה */}
                  <td style={{ ...TD, paddingTop: '12px', fontSize: '13px', color: 'var(--fg-2)', overflow: 'hidden', width: '74px', maxWidth: '74px', textOverflow: 'ellipsis' }}>
                    {lead.last_name || <span style={{ color: 'var(--fg-4)' }}>—</span>}
                  </td>

                  {/* טלפון */}
                  <td style={{ ...TD, paddingTop: '10px', overflow: 'hidden', width: '122px', maxWidth: '122px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums', direction: 'ltr', display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {formatPhone(lead.phone || '')}
                      </span>
                      {lead.phone && (
                        <Link href={`/conversations?lead_id=${lead.id}`}
                          onClick={e => e.stopPropagation()}
                          title="פתח שיחה"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', flexShrink: 0 }}>
                          <MessageCircle size={11} />
                        </Link>
                      )}
                      {apptByLead[lead.id] && (
                        <Link href={`/appointments?date=${apptDateParam(apptByLead[lead.id].scheduled_at)}&highlight=${apptByLead[lead.id].id}`}
                          onClick={e => e.stopPropagation()}
                          title="פתח ביומן"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', flexShrink: 0 }}>
                          <Calendar size={11} />
                        </Link>
                      )}
                    </div>
                  </td>

                  {/* סטטוס — "ממתין לנציג" מחליף את תג הסטטוס (כמו שהיה
                      במקור), אבל עדיין לחיץ לשינוי — וכל שינוי ידני (לכל
                      סטטוס, לא רק פורסם/לא רלוונטי) מנקה "ממתין לנציג"
                      ומחזיר לתצוגת הסטטוס האמיתי (ראה changeStatus/
                      clearEscalation). תזכורת/אין-מענה לא דורסים יותר —
                      רק ממתין לנציג, כי רק לו יש עכשיו נקודת-יציאה ברורה */}
                  <td style={{ ...TD, paddingTop: '11px', overflow: 'hidden', width: '122px', maxWidth: '122px' }}>
                    <span
                      onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setStatusDropdown(prev => prev?.leadId === lead.id ? null : { leadId: lead.id, x: r.left, y: r.bottom + 4 }) }}
                      title={[
                        status.label,
                        isEscalated && 'ממתין לנציג',
                        isDue && 'תזכורת הגיע מועדה',
                        isNoAnswer && 'הלקוח לא הגיב מעל 6 שעות',
                      ].filter(Boolean).join(' · ') + ' — לחץ לשינוי סטטוס'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', minWidth: 0, cursor: 'pointer' }}>
                      {isEscalated ? (
                        <span className="reminder-badge" style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '92px' }}>
                          ממתין לנציג
                        </span>
                      ) : (
                        <span className={`status-${lead.status}`} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '92px' }}>
                          {status.label}
                        </span>
                      )}
                      <Pencil size={10} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
                    </span>
                  </td>

                  {/* סיבת פנייה — לחיצה עוברת לעריכה ידנית.
                      width+maxWidth מפורשים בנוסף ל-overflow:hidden — גילינו
                      בבדיקה בפועל ש-table-layout:fixed לבד לא תמיד עוצר תא
                      שהתוכן שלו "דוחף" רוחב, גם כשיש overflow:hidden */}
                  <td style={{ ...TD, paddingTop: '11px', overflow: 'hidden', width: '110px', maxWidth: '110px' }} onClick={e => e.stopPropagation()}>
                    {editingTreatment === lead.id ? (
                      <select
                        autoFocus
                        value={treatmentVal}
                        onChange={e => { setTreatmentVal(e.target.value); saveTreatment(lead.id, e.target.value) }}
                        onBlur={() => setEditingTreatment(null)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditingTreatment(null) }}
                        className="input-base"
                        style={{ width: '100%', padding: '3px 6px', fontSize: '11px' }}
                      >
                        <option value="">— בחר —</option>
                        {services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                        <option value="אחר">אחר</option>
                        {treatmentVal && !services.some(s => s.name === treatmentVal) && treatmentVal !== 'אחר' && (
                          <option value={treatmentVal}>{treatmentVal}</option>
                        )}
                      </select>
                    ) : lead.treatment_type ? (
                      <span
                        onClick={() => startEditTreatment(lead)}
                        title={TREATMENT_LABELS[lead.treatment_type as TreatmentType] || lead.treatment_type}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', maxWidth: '100%', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 7px', borderRadius: '6px', background: tColor ? `${tColor}18` : 'var(--bg-hover)', color: tColor || 'var(--fg-3)', border: `1px solid ${tColor ? `${tColor}30` : 'var(--border-subtle)'}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '84px' }}>
                          {TREATMENT_LABELS[lead.treatment_type as TreatmentType] || lead.treatment_type}
                        </span>
                        <Pencil size={10} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
                      </span>
                    ) : (
                      <span onClick={() => startEditTreatment(lead)} title="לחץ להזנה" style={{ color: 'var(--fg-4)', fontSize: '12px', cursor: 'pointer' }}>+ הוסף</span>
                    )}
                  </td>

                  {/* מקור */}
                  <td style={{ ...TD, paddingTop: '11px', overflow: 'hidden', width: '68px', maxWidth: '68px' }}>
                    {(() => {
                      const sColor = SOURCE_COLORS[lead.source]
                      return (
                        <span title={SOURCE_LABELS[lead.source] || lead.source} style={{ display: 'inline-block', maxWidth: '54px', fontSize: '11px', fontWeight: 500, color: sColor || 'var(--fg-3)', background: sColor ? `${sColor}18` : 'var(--bg-sunken)', border: `1px solid ${sColor ? `${sColor}30` : 'var(--border-subtle)'}`, padding: '3px 6px', borderRadius: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {SOURCE_LABELS[lead.source] || lead.source}
                        </span>
                      )
                    })()}
                  </td>

                  {/* סיכום AI — width+overflow:hidden+overflowWrap מפורשים, לא רק
                      maxHeight על הטקסט הפנימי: טקסט חופשי ארוך בלי רווחים
                      במקום הנכון (או במקרי-קצה של table-layout:fixed) יכול
                      "לדחוף" את התא הזה רחב יותר מהעמודה ולדרוס את השכנות */}
                  <td style={{ ...TD, whiteSpace: 'normal', verticalAlign: 'top', overflow: 'hidden', width: '150px', maxWidth: '150px' }}>
                    {isAnalyzing
                      ? <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>מנתח...</span>
                      : lead.ai_summary
                        ? <span style={{ fontSize: '11px', color: 'var(--fg-2)', display: 'block', lineHeight: 1.45, overflow: 'hidden', maxHeight: '3.2em', overflowWrap: 'break-word', wordBreak: 'break-word' }}>{lead.ai_summary}</span>
                        : <span style={{ color: 'var(--fg-4)', fontSize: '11px' }}>—</span>
                    }
                  </td>

                  {/* אינטראקציה אחרונה — ידנית (lead_activities) או שיחת בוט (messages), הכי עדכנית מביניהן.
                      width+overflow:hidden+overflowWrap מפורשים — ראה הערה בעמודת "סיכום AI" */}
                  <td style={{ ...TD, whiteSpace: 'normal', verticalAlign: 'top', overflow: 'hidden', width: '150px', maxWidth: '150px' }}>
                    {(() => {
                      const li = lastInteractions[lead.id]
                      if (!li) return <span style={{ color: 'var(--fg-4)', fontSize: '11px' }}>—</span>
                      const isFresh = li.detail.length <= 80
                      const hasFreshSummary = lead.last_interaction_summary && lead.last_interaction_summarized_at
                        && new Date(lead.last_interaction_summarized_at) >= new Date(li.at)
                      const isSummarizing = summarizingInteraction.has(lead.id)
                      const shown = isFresh ? li.detail : hasFreshSummary ? lead.last_interaction_summary : li.detail
                      return (
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: INTERACTION_KIND_COLOR[li.kind] || 'var(--fg-4)', flexShrink: 0 }} />
                            <span style={{ fontSize: '10px', fontWeight: 600, color: INTERACTION_KIND_COLOR[li.kind] || 'var(--brand)' }}>{li.label}</span>
                            <span style={{ fontSize: '9px', color: 'var(--fg-4)' }}>· {fmtRelative(li.at)}</span>
                            {!isFresh && isSummarizing && <span style={{ fontSize: '9px', color: 'var(--fg-4)' }}>· מסכם...</span>}
                          </div>
                          {shown && (
                            <span style={{ fontSize: '11px', color: 'var(--fg-2)', display: 'block', lineHeight: 1.4, overflow: 'hidden', maxHeight: '2.8em', overflowWrap: 'break-word', wordBreak: 'break-word' }}>{shown}</span>
                          )}
                        </div>
                      )
                    })()}
                  </td>

                  {/* תזכורת — לחיצה פותחת בחירת תאריך ושעה */}
                  <td style={{ ...TD, paddingTop: '11px', overflow: 'hidden', width: '96px', maxWidth: '96px' }} onClick={e => { e.stopPropagation(); openReminder(lead) }}>
                    {rem ? (
                      <span title="לחץ לעריכת התזכורת" style={{
                        fontSize: '10px', fontWeight: rem.due ? 700 : 500, padding: '3px 7px',
                        borderRadius: '10px', color: rem.color, background: rem.bg,
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '1px',
                        alignItems: 'flex-start', lineHeight: 1.3, width: 'fit-content',
                      }}>
                        <span>{rem.dayLabel}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rem.timeStr}</span>
                      </span>
                    ) : (
                      <span title="לחץ לקביעת תזכורת" style={{
                        fontSize: '11px', color: 'var(--fg-4)', cursor: 'pointer',
                        border: '1px dashed var(--border-default)', borderRadius: '20px', padding: '2px 8px',
                      }}>+ קבע</span>
                    )}
                  </td>

                  {/* נוצר */}
                  <td style={{ ...TD, overflow: 'hidden', width: '76px', maxWidth: '76px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(lead.created_at)}</span>
                      <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>{fmtRelative(lead.updated_at || lead.created_at)}</span>
                    </div>
                  </td>

                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ─── כרטיסי לידים — תצוגת מובייל בלבד, במקום טבלה קבועת-רוחב ─── */}
      <div className="leads-mobile-cards">
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Search size={30} style={{ color: 'var(--fg-4)', margin: '0 auto 10px', display: 'block' }} />
            <p style={{ color: 'var(--fg-3)', fontWeight: 500, fontSize: '14px' }}>לא נמצאו לידים</p>
            <p style={{ color: 'var(--fg-4)', fontSize: '12px', marginTop: '3px' }}>שנה את החיפוש או הסינון</p>
          </div>
        )}
        {rows.map(({ lead, status, isNew, tColor, rem, isDue, isEscalated, isNoAnswer, isSelected }) => (
          <div key={lead.id}
            className="card"
            onClick={() => { markOpened(lead.id); setOpenLeadId(lead.id) }}
            style={{
              padding: '13px 14px', marginBottom: '10px', cursor: 'pointer',
              background: isSelected ? 'var(--brand-soft)' : (isEscalated || isDue) ? 'var(--danger-soft)' : undefined,
              borderRight: (isEscalated || isDue) ? '3px solid var(--danger)' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getDisplayName(lead) || '—'}
                  </span>
                  {isNew && <span style={{ background: 'var(--brand)', color: 'white', fontSize: '8px', fontWeight: 700, padding: '2px 4px', borderRadius: '4px', flexShrink: 0 }}>חדש</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums', direction: 'ltr', display: 'inline-block' }}>
                    {formatPhone(lead.phone || '')}
                  </span>
                  {lead.phone && (
                    <Link href={`/conversations?lead_id=${lead.id}`}
                      onClick={e => e.stopPropagation()}
                      title="פתח שיחה"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', flexShrink: 0 }}>
                      <MessageCircle size={10} />
                    </Link>
                  )}
                  {apptByLead[lead.id] && (
                    <Link href={`/appointments?date=${apptDateParam(apptByLead[lead.id].scheduled_at)}&highlight=${apptByLead[lead.id].id}`}
                      onClick={e => e.stopPropagation()}
                      title="פתח ביומן"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', flexShrink: 0 }}>
                      <Calendar size={10} />
                    </Link>
                  )}
                </div>
              </div>
              <input type="checkbox" checked={isSelected} onChange={() => toggleOne(lead.id)}
                onClick={e => e.stopPropagation()}
                style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--brand)', flexShrink: 0, marginTop: '2px' }} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: rem ? '8px' : 0 }}>
              {isEscalated ? (
                <span className="reminder-badge" style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px' }}>
                  ממתין לנציג
                </span>
              ) : (
                <span className={`status-${lead.status}`} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: 500 }}>
                  {status.label}
                </span>
              )}
              {lead.treatment_type && (
                <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 7px', borderRadius: '6px', background: tColor ? `${tColor}18` : 'var(--bg-hover)', color: tColor || 'var(--fg-3)', border: `1px solid ${tColor ? `${tColor}30` : 'var(--border-subtle)'}` }}>
                  {TREATMENT_LABELS[lead.treatment_type as TreatmentType] || lead.treatment_type}
                </span>
              )}
              <span style={{ fontSize: '11px', fontWeight: 500, color: SOURCE_COLORS[lead.source] || 'var(--fg-3)', background: SOURCE_COLORS[lead.source] ? `${SOURCE_COLORS[lead.source]}18` : 'var(--bg-sunken)', border: `1px solid ${SOURCE_COLORS[lead.source] ? `${SOURCE_COLORS[lead.source]}30` : 'var(--border-subtle)'}`, padding: '3px 6px', borderRadius: '20px' }}>
                {SOURCE_LABELS[lead.source] || lead.source}
              </span>
            </div>

            {rem && (
              <div onClick={e => { e.stopPropagation(); openReminder(lead) }} style={{ marginBottom: '8px' }}>
                <span style={{ fontSize: '10px', fontWeight: rem.due ? 700 : 500, padding: '3px 7px', borderRadius: '20px', color: rem.color, background: rem.bg }}>
                  🔔 {rem.dayLabel} {rem.timeStr}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--fg-4)' }}>
              <span>נוצר {fmtDate(lead.created_at)}</span>
              <span>{fmtRelative(lead.updated_at || lead.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ─── חלון קביעת תזכורת ─── */}
      {reminderFor && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setReminderFor(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
        >
          <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '22px 24px', width: '340px', maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)' }}>⏰ תזכורת לשיחה</h3>
              <button onClick={() => setReminderFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '2px', display: 'flex' }}>
                <X size={17} />
              </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--fg-4)' }}>
              {getDisplayName(reminderFor) || reminderFor.phone}
            </p>

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '6px' }}>
              מתי לחזור ללקוח?
            </label>
            <input
              type="datetime-local"
              value={reminderVal}
              onChange={e => setReminderVal(e.target.value)}
              className="input-base"
              style={{ width: '100%', marginBottom: '12px' }}
            />

            {/* קיצורי דרך נפוצים */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
              {[
                { label: 'מחר בבוקר', days: 1, hour: 9 },
                { label: 'בעוד יומיים', days: 2, hour: 10 },
                { label: 'בעוד שבוע', days: 7, hour: 10 },
              ].map(s => (
                <button key={s.label}
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() + s.days)
                    d.setHours(s.hour, 0, 0, 0)
                    setReminderVal(toLocalInput(d.toISOString()))
                  }}
                  style={{
                    padding: '5px 11px', borderRadius: '20px', fontSize: '11px',
                    border: '1px solid var(--border-default)', background: 'var(--bg-sunken)',
                    color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>{s.label}</button>
              ))}
            </div>

            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '6px' }}>
              למה לחזור? <span style={{ fontWeight: 400, color: 'var(--fg-4)' }}>(לא חובה)</span>
            </label>
            <textarea
              value={reminderReason}
              onChange={e => setReminderReason(e.target.value)}
              rows={2}
              placeholder="למשל: ביקש לחשוב על המחיר, לא היה זמין עכשיו..."
              className="input-base"
              style={{ width: '100%', marginBottom: '18px', resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => saveReminder(false)} disabled={savingReminder || !reminderVal}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                  background: savingReminder || !reminderVal ? 'var(--border-default)' : 'var(--brand)',
                  color: savingReminder || !reminderVal ? 'var(--fg-3)' : 'white',
                  fontWeight: 600, fontSize: '13px', fontFamily: 'inherit',
                  cursor: savingReminder || !reminderVal ? 'default' : 'pointer',
                }}>
                {savingReminder ? 'שומר...' : 'שמור תזכורת'}
              </button>
              {reminderFor.next_followup && (
                <button onClick={() => saveReminder(true)} disabled={savingReminder}
                  style={{
                    padding: '10px 14px', borderRadius: '10px', border: '1px solid #FCA5A5',
                    background: '#FEF2F2', color: '#DC2626', fontWeight: 600, fontSize: '13px',
                    fontFamily: 'inherit', cursor: 'pointer',
                  }}>
                  הסר
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── כרטיס ליד — חלון קופץ במקום מעבר למסך נפרד ─── */}
      {openLeadId && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setOpenLeadId(null); load() } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', direction: 'rtl' }}
        >
          <div style={{ background: 'var(--bg-canvas)', borderRadius: '16px', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', position: 'relative' }}>
            <button
              onClick={() => { setOpenLeadId(null); load() }}
              aria-label="סגור"
              style={{ position: 'absolute', top: '14px', left: '14px', zIndex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '8px', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--fg-3)' }}
            >
              <X size={15} />
            </button>
            <LeadDetail leadId={openLeadId} onClose={() => { setOpenLeadId(null); load() }} />
          </div>
        </div>
      )}

      {ConfirmDialog}

      {/* ─── Column Filter Dropdown ─── */}
      {colDropdown && dropdownMeta && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: colDropdown.y, left: colDropdown.x,
          background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)',
          borderRadius: '10px', padding: '6px', zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: '160px', direction: 'rtl',
        }}>
          <button
            onClick={() => { setFilters(f => ({ ...f, [dropdownMeta.key]: '' })); setColDropdown(null) }}
            style={{ display: 'block', width: '100%', textAlign: 'right', padding: '7px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', background: !filters[dropdownMeta.key] ? 'var(--brand-soft)' : 'transparent', color: !filters[dropdownMeta.key] ? 'var(--brand)' : 'var(--fg-3)', fontWeight: !filters[dropdownMeta.key] ? 600 : 400 }}
          >
            הכל
          </button>
          {dropdownMeta.opts.map(opt => (
            <button key={opt}
              onClick={() => { setFilters(f => ({ ...f, [dropdownMeta.key]: opt })); setColDropdown(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'right', padding: '7px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', background: filters[dropdownMeta.key] === opt ? 'var(--brand-soft)' : 'transparent', color: filters[dropdownMeta.key] === opt ? 'var(--brand)' : 'var(--fg-2)', fontWeight: filters[dropdownMeta.key] === opt ? 600 : 400 }}
            >
              {dropdownMeta.labels[opt]}
            </button>
          ))}
        </div>
      )}

      {/* ─── Status Change Dropdown ─── */}
      {statusDropdown && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: statusDropdown.y, left: statusDropdown.x,
          background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)',
          borderRadius: '10px', padding: '6px', zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: '150px', direction: 'rtl',
          maxHeight: '260px', overflowY: 'auto',
        }}>
          {ALL_STATUSES.map(s => {
            const cfg = STATUS_CONFIG[s as LeadStatus]
            const lead = leads.find(l => l.id === statusDropdown.leadId)
            const isCurrent = lead?.status === s
            return (
              <button key={s}
                onClick={() => changeStatus(statusDropdown.leadId, s as LeadStatus)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'right', padding: '7px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', background: isCurrent ? 'var(--brand-soft)' : 'transparent', color: 'var(--fg-2)' }}
              >
                <span className={`status-${s}`} style={{ padding: '2px 8px', borderRadius: '20px', fontWeight: 500 }}>{cfg.label}</span>
                {isCurrent && <Check size={13} style={{ color: 'var(--brand)' }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
