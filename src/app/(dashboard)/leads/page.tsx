'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  STATUS_CONFIG, SOURCE_LABELS, STATUS_LABELS, TREATMENT_LABELS, TREATMENT_COLORS,
  TEMP_CONFIG, isNewLead, getDisplayName, getLeadNumber,
  type Lead, type LeadStatus, type LeadSource, type TreatmentType,
} from '@/types'
import { Search, MessageSquare, X, Eye, ArrowUpDown, ListFilter } from 'lucide-react'
import Link from 'next/link'

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

function followupBadge(d: string | null) {
  if (!d) return null
  const diff = Math.floor((new Date(d).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (diff < 0)   return { label: fmtDate(d), color: '#DC2626', bg: '#FEF2F2' }
  if (diff === 0) return { label: 'היום',      color: '#D97706', bg: '#FFFBEB' }
  if (diff === 1) return { label: 'מחר',        color: '#7C3AED', bg: '#F5F3FF' }
  return            { label: fmtDate(d),         color: '#2563EB', bg: '#EFF6FF' }
}

/* ─── constants ─── */
const ALL_STATUSES = ['new','contacted','in_progress','published','not_relevant','no_show','arrived','quote_sent','quote_followup','closed','lost']
const ALL_SOURCES  = ['backoffice','whatsapp','social','outreach','manual','scrape','bot']
const ALL_TREATS   = ['implant','restorative','veneers','whitening','orthodontics','checkup','other']

type SortKey      = 'created_at' | 'next_followup'
type FilterKey    = 'status' | 'source' | 'treatment_type' | 'assigned'

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
}
const TD: React.CSSProperties = { padding: '7px 10px', verticalAlign: 'top' }

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
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey]     = useState<SortKey>('created_at')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [aiPopup, setAiPopup]     = useState<{ id: string; x: number; y: number } | null>(null)
  const [colDropdown, setColDropdown] = useState<{ col: string; x: number; y: number } | null>(null)
  const analysisStarted           = useRef(false)
  const aiHideTimer               = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: l }, { data: p }, { data: c }] = await Promise.all([
        supabase.from('leads').select('*, profile:profiles!leads_assigned_to_fkey(full_name)').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*'),
        supabase.from('conversations').select('contact_phone').not('contact_phone', 'is', null),
      ])
      setLeads(l || [])
      setProfiles(p || [])
      setConvPhones(new Set((c || []).map((x: any) => x.contact_phone)))
      setLoading(false)
    }
    load()
  }, [])

  // Close column dropdown on outside click
  useEffect(() => {
    if (!colDropdown) return
    const handler = () => setColDropdown(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [colDropdown])

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

  function openAIPopup(e: React.MouseEvent, leadId: string) {
    if (aiHideTimer.current) clearTimeout(aiHideTimer.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setAiPopup({ id: leadId, x: rect.left + rect.width / 2, y: rect.top })
  }
  function scheduleCloseAI()  { aiHideTimer.current = setTimeout(() => setAiPopup(null), 200) }
  function cancelCloseAI()    { if (aiHideTimer.current) clearTimeout(aiHideTimer.current) }

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
        return matchQ
          && (!filters.status || l.status === filters.status)
          && (!filters.source || l.source === filters.source)
          && (!filters.assigned || l.assigned_to === filters.assigned)
          && (!filters.treatment_type || l.treatment_type === filters.treatment_type)
      })
      .sort((a, b) => {
        const av = a[sortKey] || '', bv = b[sortKey] || ''
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [leads, search, filters, sortKey, sortDir])

  const hasFilters  = Object.values(filters).some(Boolean)
  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id))

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(filtered.map(l => l.id))) }
  function toggleOne(id: string) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  const popupLead = aiPopup ? leads.find(l => l.id === aiPopup.id) : null
  const dropdownMeta = colDropdown ? COL_FILTERS[colDropdown.col] : null

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
    <div style={{ padding: '22px 26px' }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '3px' }}>ניהול לידים</h1>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)' }}>
            {filtered.length} מוצגים{leads.length !== filtered.length ? ` מתוך ${leads.length}` : ''}
            {selected.size > 0 && ` · ${selected.size} נבחרו`}
          </p>
        </div>
        <Link href="/leads/new" style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'var(--brand)', color: 'white', fontWeight: 600,
          padding: '9px 16px', borderRadius: 'var(--radius-md)', textDecoration: 'none',
          fontSize: '13px', boxShadow: '0 1px 4px rgba(43,107,232,0.25)',
        }}>
          + ליד חדש
        </Link>
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
          <button onClick={() => setFilters({ status: '', source: '', treatment_type: '', assigned: '' })}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: 'var(--radius-md)', padding: '7px 12px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
            <X size={11} /> נקה סינון ({Object.values(filters).filter(Boolean).length})
          </button>
        )}
      </div>

      {/* ─── Table ─── */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
              <th style={{ ...TH, width: '38px', paddingRight: '14px' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
              </th>
              <th style={{ ...TH, width: '50px' }}>מס'</th>
              <th style={{ ...TH, width: '80px' }}>שם פרטי</th>
              <th style={{ ...TH, width: '80px' }}>שם משפחה</th>
              <th style={{ ...TH, width: '106px' }}>טלפון</th>
              <FilterTH col="status"         label="סטטוס"      width="112px" />
              <FilterTH col="treatment_type" label="סיבת פנייה" width="90px"  />
              <FilterTH col="source"         label="מקור"        width="74px"  />
              <th style={{ ...TH, width: '130px' }}>סיכום AI</th>
              <th style={{ ...TH, width: '130px' }}>המלצת AI</th>
              <th style={{ ...TH, width: '84px', cursor: 'pointer' }} onClick={() => toggleSort('next_followup')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  מעקב <ArrowUpDown size={10} style={{ color: sortKey === 'next_followup' ? 'var(--brand)' : 'var(--fg-4)' }} />
                </span>
              </th>
              <th style={{ ...TH, width: '88px', cursor: 'pointer' }} onClick={() => toggleSort('created_at')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  נוצר <ArrowUpDown size={10} style={{ color: sortKey === 'created_at' ? 'var(--brand)' : 'var(--fg-4)' }} />
                </span>
              </th>
              <th style={{ ...TH, width: '76px', textAlign: 'center' }}>פעולות</th>
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

            {filtered.map(lead => {
              const status      = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new
              const temp        = lead.temperature ? TEMP_CONFIG[lead.temperature] : null
              const isNew       = isNewLead(lead)
              const tColor      = lead.treatment_type ? TREATMENT_COLORS[lead.treatment_type as TreatmentType] : undefined
              const hasChatHistory = lead.phone ? convPhones.has(lead.phone) : false
              const waPhone     = lead.phone ? '972' + lead.phone.replace(/^0/, '').replace(/-/g, '') : null
              const followup    = followupBadge(lead.next_followup)
              const isSelected  = selected.has(lead.id)
              const isAnalyzing = analyzing.has(lead.id)
              const hasAI       = !!(lead.ai_summary || lead.ai_recommendation)

              return (
                <tr key={lead.id}
                  style={{ borderBottom: '1px solid var(--border-subtle)', background: isSelected ? 'var(--brand-soft)' : undefined, transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  {/* ○ */}
                  <td style={{ ...TD, paddingRight: '14px', paddingTop: '13px' }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(lead.id)}
                      style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--brand)' }} />
                  </td>

                  {/* מס' */}
                  <td style={{ ...TD, paddingTop: '13px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{getLeadNumber(lead)}</span>
                      {isNew && <span style={{ background: 'var(--brand)', color: 'white', fontSize: '8px', fontWeight: 700, padding: '2px 4px', borderRadius: '4px', lineHeight: 1, alignSelf: 'flex-start' }}>חדש</span>}
                    </div>
                  </td>

                  {/* שם פרטי */}
                  <td style={{ ...TD, paddingTop: '12px' }}>
                    <Link href={`/leads/${lead.id}`} onClick={() => markOpened(lead.id)}
                      style={{ fontWeight: 500, color: 'var(--fg-1)', textDecoration: 'none', fontSize: '13px' }}>
                      {lead.first_name || lead.name || '—'}
                    </Link>
                  </td>

                  {/* שם משפחה */}
                  <td style={{ ...TD, paddingTop: '12px', fontSize: '13px', color: 'var(--fg-2)' }}>
                    {lead.last_name || <span style={{ color: 'var(--fg-4)' }}>—</span>}
                  </td>

                  {/* טלפון */}
                  <td style={{ ...TD, paddingTop: '10px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums', direction: 'ltr', display: 'inline-block', whiteSpace: 'nowrap' }}>
                      {formatPhone(lead.phone || '')}
                    </span>
                  </td>

                  {/* סטטוס */}
                  <td style={{ ...TD, paddingTop: '11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span className={`${status.bg} ${status.text}`} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {status.label}
                      </span>
                      {temp && <span title={temp.label} className={temp.dot} style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, display: 'inline-block' }} />}
                    </div>
                  </td>

                  {/* סיבת פנייה */}
                  <td style={{ ...TD, paddingTop: '11px' }}>
                    {lead.treatment_type ? (
                      <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 7px', borderRadius: '6px', background: tColor ? `${tColor}18` : 'var(--bg-hover)', color: tColor || 'var(--fg-3)', border: `1px solid ${tColor ? `${tColor}30` : 'var(--border-subtle)'}`, whiteSpace: 'nowrap' }}>
                        {TREATMENT_LABELS[lead.treatment_type as TreatmentType]}
                      </span>
                    ) : <span style={{ color: 'var(--fg-4)', fontSize: '12px' }}>—</span>}
                  </td>

                  {/* מקור */}
                  <td style={{ ...TD, paddingTop: '11px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-3)', background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', padding: '3px 6px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </span>
                  </td>

                  {/* סיכום AI */}
                  <td style={{ ...TD }}>
                    {isAnalyzing
                      ? <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>מנתח...</span>
                      : lead.ai_summary
                        ? <span style={{ fontSize: '11px', color: 'var(--fg-2)', display: 'block', lineHeight: 1.45, overflow: 'hidden', maxHeight: '3.2em' }}>{lead.ai_summary}</span>
                        : <span style={{ color: 'var(--fg-4)', fontSize: '11px' }}>—</span>
                    }
                  </td>

                  {/* המלצת AI */}
                  <td style={{ ...TD }}>
                    {isAnalyzing
                      ? <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>מנתח...</span>
                      : lead.ai_recommendation
                        ? <span style={{ fontSize: '11px', color: '#5B21B6', display: 'block', lineHeight: 1.45, overflow: 'hidden', maxHeight: '3.2em' }}>{lead.ai_recommendation}</span>
                        : <span style={{ color: 'var(--fg-4)', fontSize: '11px' }}>—</span>
                    }
                  </td>

                  {/* מעקב */}
                  <td style={{ ...TD, paddingTop: '11px' }}>
                    {followup
                      ? <span style={{ fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '20px', color: followup.color, background: followup.bg, whiteSpace: 'nowrap' }}>{followup.label}</span>
                      : <span style={{ color: 'var(--fg-4)', fontSize: '11px' }}>—</span>
                    }
                  </td>

                  {/* נוצר */}
                  <td style={{ ...TD }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(lead.created_at)}</span>
                      <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>{fmtRelative(lead.updated_at || lead.created_at)}</span>
                    </div>
                  </td>

                  {/* פעולות */}
                  <td style={{ ...TD, textAlign: 'center', paddingTop: '11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <Link href={`/leads/${lead.id}`} onClick={() => markOpened(lead.id)} title="צפה בליד"
                        style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Eye size={11} style={{ color: 'var(--fg-3)' }} />
                      </Link>
                      {waPhone && (
                        <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" title="WhatsApp"
                          style={{ width: '26px', height: '26px', borderRadius: '7px', background: hasChatHistory ? '#EBFBF4' : 'var(--bg-sunken)', border: hasChatHistory ? 'none' : '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <MessageSquare size={11} style={{ color: hasChatHistory ? '#0F9E7B' : 'var(--fg-4)' }} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ─── AI Popup ─── */}
      {aiPopup && popupLead && (popupLead.ai_summary || popupLead.ai_recommendation) && (
        <div onMouseEnter={cancelCloseAI} onMouseLeave={scheduleCloseAI} style={{
          position: 'fixed', top: aiPopup.y - 10, left: aiPopup.x,
          transform: 'translate(-50%, -100%)', width: '300px',
          background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)',
          borderRadius: '12px', padding: '14px 16px', zIndex: 9999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)', direction: 'rtl',
        }}>
          {popupLead.ai_summary && (
            <div style={{ marginBottom: popupLead.ai_recommendation ? '10px' : 0 }}>
              <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fg-3)', marginBottom: '5px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>סיכום</p>
              <p style={{ fontSize: '13px', color: 'var(--fg-1)', lineHeight: 1.55, margin: 0 }}>{popupLead.ai_summary}</p>
            </div>
          )}
          {popupLead.ai_recommendation && (
            <div style={{ borderTop: popupLead.ai_summary ? '1px solid var(--border-subtle)' : 'none', paddingTop: popupLead.ai_summary ? '10px' : 0 }}>
              <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fg-3)', marginBottom: '5px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>המלצה</p>
              <p style={{ fontSize: '13px', color: '#5B21B6', lineHeight: 1.55, margin: 0 }}>{popupLead.ai_recommendation}</p>
            </div>
          )}
        </div>
      )}

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
    </div>
  )
}
