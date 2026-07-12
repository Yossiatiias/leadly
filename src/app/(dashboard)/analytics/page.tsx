'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id: string
  name: string
  status: string
  temperature: string
  source: string
  treatment_type: string | null
  assigned_to: string | null
  created_at: string
  profile?: { full_name: string } | null
}

// ─── Labels ───────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  new: 'חדש', contacted: 'אין מענה', in_progress: 'למעקב',
  published: 'נקבע תור', not_relevant: 'לא רלוונטי',
  no_show: 'לא הגיע', arrived: 'הגיע', quote_sent: 'הצעת מחיר',
  quote_followup: 'מעקב אחר הצעה', closed: 'נסגר', lost: 'אבוד',
}
const SOURCE_LABELS: Record<string, string> = {
  backoffice: 'בקאופיס', whatsapp: 'בוט וואטסאפ', social: 'רשתות',
  outreach: 'יזום', manual: 'הזנה ידנית', scrape: 'סריקה', bot: 'בוט',
}
const TEMP_LABELS: Record<string, string> = { hot: 'חם', medium: 'בינוני', cold: 'קר' }

const TREATMENT_LABELS: Record<string, string> = {
  implant:      'השתלות',
  restorative:  'טיפול משמר',
  veneers:      'ציפויים',
  whitening:    'הלבנה',
  orthodontics: 'יישור שיניים',
  checkup:      'בדיקה ואבחון',
  other:        'אחר',
}
const TREATMENT_COLORS: Record<string, string> = {
  implant:      '#6366F1',
  restorative:  '#10B981',
  veneers:      '#F59E0B',
  whitening:    '#3B82F6',
  orthodontics: '#EC4899',
  checkup:      '#14B8A6',
  other:        '#9CA3AF',
}

// ─── Funnel stages ────────────────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'total',          label: 'לידים שהגיעו',       tooltip: 'סך כל הלידים שנכנסו למערכת בתקופה הנבחרת',                                         color: '#BE185D', filter: (l: Lead[]) => l },
  { key: 'new',            label: 'חדש',                 tooltip: 'ליד שנרשם ועדיין לא טופל — ממתין לטיפול ראשוני',                                    color: '#1D4ED8', filter: (l: Lead[]) => l.filter(x => x.status === 'new') },
  { key: 'no_answer',      label: 'אין מענה',            tooltip: 'ניסיון יצירת קשר בוצע אך הלקוח לא ענה — נדרש מעקב נוסף',                          color: '#C2410C', filter: (l: Lead[]) => l.filter(x => x.status === 'contacted') },
  { key: 'follow_up',      label: 'למעקב',               tooltip: 'הלקוח ביקש שיחזרו אליו במועד מאוחר יותר — ממתין לחזרה',                           color: '#B45309', filter: (l: Lead[]) => l.filter(x => x.status === 'in_progress') },
  { key: 'not_relevant',   label: 'לא רלוונטי',          tooltip: 'ליד שאינו מתאים לשירות',                                                           color: '#4B5563', filter: (l: Lead[]) => l.filter(x => x.status === 'not_relevant') },
  { key: 'booked',         label: 'נקבע תור',            tooltip: 'הושג הסכם על פגישה או תור — הליד הומר בהצלחה לתיאום מוגדר',                       color: '#065F46', filter: (l: Lead[]) => l.filter(x => x.status === 'published') },
  { key: 'no_show',        label: 'לא הגיעו',            tooltip: 'הלקוח לא הגיע לתור שנקבע — נדרש תיאום מחדש',                                      color: '#7C3AED', filter: (l: Lead[]) => l.filter(x => x.status === 'no_show') },
  { key: 'arrived',        label: 'הגיע',                tooltip: 'הלקוח הגיע לתור ונמצא כעת במעקב פעיל לקידום תהליך הרכישה',                       color: '#0369A1', filter: (l: Lead[]) => l.filter(x => x.status === 'arrived') },
  { key: 'quote_sent',     label: 'הצעת מחיר',           tooltip: 'הוגשה ללקוח הצעת מחיר — ממתין לבחינתה ולקבלת החלטה סופית',                        color: '#0891B2', filter: (l: Lead[]) => l.filter(x => x.status === 'quote_sent') },
  { key: 'quote_followup', label: 'מעקב אחר הצעת מחיר', tooltip: 'הצעת המחיר נמצאת בשלב שיחה — מתנהל מעקב פעיל במטרה לסגור את העסקה',             color: '#0284C7', filter: (l: Lead[]) => l.filter(x => x.status === 'quote_followup') },
  { key: 'closed',         label: 'נסגר',                tooltip: 'העסקה נסגרה בהצלחה — הלקוח שילם והפך ללקוח פעיל',                                color: '#15803D', filter: (l: Lead[]) => l.filter(x => x.status === 'closed') },
  { key: 'lost',           label: 'אבוד',                tooltip: 'הלקוח סירב להצעה ועבר למתחרה — ליד שאבד מהמשפך',                                 color: '#991B1B', filter: (l: Lead[]) => l.filter(x => x.status === 'lost') },
]

// ─── Pivot dimensions ─────────────────────────────────────────────────────────
const PIVOT_DIMS = [
  { key: 'count',          label: 'כמות' },
  { key: 'month',          label: 'חודש' },
  { key: 'year',           label: 'שנה' },
  { key: 'week',           label: 'שבוע' },
  { key: 'quarter',        label: 'רבעון' },
  { key: 'source',         label: 'מקור' },
  { key: 'status',         label: 'סטטוס' },
  { key: 'temperature',    label: 'טמפרטורה' },
  { key: 'assigned',       label: 'איש מכירות' },
  { key: 'treatment_type', label: 'סוג טיפול' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getDimValue(lead: Lead, dim: string): string {
  const d = new Date(lead.created_at)
  switch (dim) {
    case 'month':   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    case 'year':    return String(d.getFullYear())
    case 'week': {
      const start = new Date(d.getFullYear(), 0, 1)
      const w = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
      return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`
    }
    case 'quarter':        return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`
    case 'source':         return SOURCE_LABELS[lead.source] || lead.source
    case 'status':         return STATUS_LABELS[lead.status] || lead.status
    case 'temperature':    return TEMP_LABELS[lead.temperature] || lead.temperature
    case 'assigned':       return lead.profile?.full_name || 'לא שויך'
    case 'treatment_type': return lead.treatment_type ? (TREATMENT_LABELS[lead.treatment_type] || lead.treatment_type) : 'לא צוין'
    case 'count':          return 'כמות'
    default: return ''
  }
}

function filterByPeriod(leads: Lead[], period: string, from: string, to: string): Lead[] {
  const now = new Date()
  if (period === 'today') {
    const t = now.toISOString().slice(0, 10)
    return leads.filter(l => l.created_at.slice(0, 10) === t)
  }
  if (period === 'week') {
    const ago = new Date(now.getTime() - 7 * 86400000)
    return leads.filter(l => new Date(l.created_at) >= ago)
  }
  if (period === 'month') {
    const ago = new Date(now.getTime() - 30 * 86400000)
    return leads.filter(l => new Date(l.created_at) >= ago)
  }
  if (period === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1)
    return leads.filter(l => new Date(l.created_at) >= start)
  }
  if (period === 'custom') {
    return leads.filter(l => {
      const d = l.created_at.slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }
  return leads
}

// ─── Funnel Chart ─────────────────────────────────────────────────────────────
function FunnelChart({ leads }: { leads: Lead[] }) {
  const [hovered, setHovered] = useState<typeof FUNNEL_STAGES[0] | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })

  const stages = FUNNEL_STAGES.map(s => ({ ...s, count: s.filter(leads).length }))
  const total = stages[0].count || 1
  const W = 560
  const segH = 52
  const H = stages.length * segH

  return (
    <div
      style={{ overflowX: 'auto', position: 'relative' }}
      onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })}
    >
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: '560px', display: 'block', margin: '0 auto' }}>
        <defs>
          <filter id="txt-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>
        {stages.map((stage, i) => {
          const n = stages.length
          const y = i * segH
          const indent = (i / n) * (W * 0.36)
          const nextIndent = ((i + 1) / n) * (W * 0.36)
          const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0
          const points = [`${indent},${y}`, `${W - indent},${y}`, `${W - nextIndent},${y + segH - 2}`, `${nextIndent},${y + segH - 2}`].join(' ')
          const cy = y + segH / 2
          const isHovered = hovered?.key === stage.key
          return (
            <g key={stage.key} filter="url(#txt-shadow)" style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(stage)}
              onMouseLeave={() => setHovered(null)}>
              <polygon points={points} fill={stage.color} opacity={isHovered ? 0.85 : 1} />
              <text x={W / 2} y={cy - 5} textAnchor="middle" fill="white"
                style={{ fontSize: '13px', fontWeight: '400', fontFamily: 'Rubik, sans-serif' }}>{stage.label}</text>
              <text x={W / 2} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.85)"
                style={{ fontSize: '11px', fontWeight: '300', fontFamily: 'Rubik, sans-serif' }}>{stage.count} לידים ({pct}%)</text>
            </g>
          )
        })}
      </svg>
      {hovered && (
        <div style={{
          position: 'fixed', left: mouse.x + 14, top: mouse.y - 56,
          background: 'rgba(15, 23, 42, 0.95)', color: 'white',
          padding: '10px 14px', borderRadius: '10px', fontSize: '12px', maxWidth: '240px',
          zIndex: 9999, pointerEvents: 'none', lineHeight: 1.6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px', color: 'white' }}>{hovered.label}</p>
          <p style={{ color: 'rgba(255,255,255,0.75)', margin: 0 }}>{hovered.tooltip}</p>
        </div>
      )}
    </div>
  )
}

// ─── Treatment Distribution Chart ─────────────────────────────────────────────
function TreatmentDistribution({ leads }: { leads: Lead[] }) {
  const [drilldown, setDrilldown] = useState<string | null>(null)

  const distribution = useMemo(() => {
    const counts: Record<string, Lead[]> = {}
    leads.forEach(l => {
      const key = l.treatment_type || 'none'
      if (!counts[key]) counts[key] = []
      counts[key].push(l)
    })
    return Object.entries(counts)
      .map(([key, leads]) => ({ key, leads, count: leads.length }))
      .sort((a, b) => b.count - a.count)
  }, [leads])

  const total = leads.length || 1
  const withTreatment = distribution.filter(d => d.key !== 'none')

  if (withTreatment.length === 0) return null

  const drillLeads = drilldown ? (distribution.find(d => d.key === drilldown)?.leads || []) : []

  return (
    <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
      <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '16px' }}>
        פילוח לפי סוג טיפול
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {withTreatment.map(({ key, count }) => {
          const color = TREATMENT_COLORS[key] || '#9CA3AF'
          const label = TREATMENT_LABELS[key] || key
          const pct = Math.round((count / total) * 100)
          const isActive = drilldown === key

          return (
            <div key={key}>
              <button
                onClick={() => setDrilldown(isActive ? null : key)}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', padding: 0, fontFamily: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)', flex: 1, textAlign: 'right' }}>{label}</span>
                  <span style={{ fontSize: '12px', color: 'var(--fg-3)' }}>{count}</span>
                  <span style={{ fontSize: '12px', color, fontWeight: 600, minWidth: '36px' }}>{pct}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--bg-sunken)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', background: color,
                    width: `${pct}%`, borderRadius: '3px',
                    transition: 'width 0.4s ease',
                    opacity: isActive ? 1 : 0.75,
                  }} />
                </div>
              </button>

              {/* Drill-down: list of leads */}
              {isActive && (
                <div style={{
                  marginTop: '10px', padding: '12px 16px',
                  background: `${color}0D`, border: `1px solid ${color}30`,
                  borderRadius: '10px',
                }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    לידים — {label}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {drillLeads.map(l => (
                      <Link key={l.id} href={`/leads/${l.id}`} style={{
                        fontSize: '12px', padding: '3px 10px', borderRadius: '6px',
                        background: 'var(--bg-surface)', color: 'var(--fg-1)',
                        border: '1px solid var(--border-subtle)', textDecoration: 'none',
                        fontWeight: 400, transition: 'all 0.1s',
                      }}>
                        {l.name}
                        <span style={{ marginRight: '6px', fontSize: '10px', color: 'var(--fg-4)' }}>
                          {STATUS_LABELS[l.status] || l.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Pivot Table ──────────────────────────────────────────────────────────────
const VALUE_TYPES = [
  { key: 'count',   label: 'ספירת לידים' },
  { key: 'pct_row', label: '% מהשורה' },
  { key: 'pct_col', label: '% מהעמודה' },
  { key: 'pct_all', label: '% מהכלל' },
]

function PivotTable({ leads }: { leads: Lead[] }) {
  const [rowDim,    setRowDim]    = useState<string | null>('month')
  const [colDim,    setColDim]    = useState<string | null>('source')
  const [valueDim,  setValueDim]  = useState<string | null>('count')
  const [valueType, setValueType] = useState<string>('count')
  const [dragOver,  setDragOver]  = useState<string | null>(null)

  const usedKeys = new Set([rowDim, colDim, valueDim].filter(Boolean) as string[])
  const available = PIVOT_DIMS.filter(d => !usedKeys.has(d.key))

  const { rows, cols, data } = useMemo(() => {
    if (!rowDim) return { rows: [] as string[], cols: [] as string[], data: {} as Record<string, Record<string, number>> }
    const rowVals = [...new Set(leads.map(l => getDimValue(l, rowDim)))].sort()
    const colVals = colDim ? [...new Set(leads.map(l => getDimValue(l, colDim)))].sort() : ['סה"כ']
    const d: Record<string, Record<string, number>> = {}
    rowVals.forEach(r => { d[r] = {} })
    leads.forEach(lead => {
      const r = getDimValue(lead, rowDim)
      const c = colDim ? getDimValue(lead, colDim) : 'סה"כ'
      d[r][c] = (d[r][c] || 0) + 1
    })
    return { rows: rowVals, cols: colVals, data: d }
  }, [leads, rowDim, colDim])

  const grandTotal = rows.reduce((s, r) => s + cols.reduce((ss, c) => ss + (data[r]?.[c] || 0), 0), 0)

  function fmtCell(r: string, c: string): string {
    const v = data[r]?.[c] || 0
    if (valueType === 'count')   return v ? String(v) : '—'
    if (valueType === 'pct_row') { const rt = cols.reduce((s, cc) => s + (data[r]?.[cc] || 0), 0); return rt ? `${Math.round(v / rt * 100)}%` : '—' }
    if (valueType === 'pct_col') { const ct = rows.reduce((s, rr) => s + (data[rr]?.[c] || 0), 0); return ct ? `${Math.round(v / ct * 100)}%` : '—' }
    if (valueType === 'pct_all') return grandTotal ? `${Math.round(v / grandTotal * 100)}%` : '—'
    return '—'
  }

  function DropZone({ zone, label, current }: { zone: 'row' | 'col' | 'val'; label: string; current: string | null }) {
    const dim = PIVOT_DIMS.find(d => d.key === current)
    const isOver = dragOver === zone
    function clear() {
      if (zone === 'row') setRowDim(null)
      else if (zone === 'col') setColDim(null)
      else setValueDim(null)
    }
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(zone) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => {
          e.preventDefault()
          const k = e.dataTransfer.getData('dimKey')
          if (!k) return
          if (rowDim    === k) setRowDim(null)
          if (colDim    === k) setColDim(null)
          if (valueDim  === k) setValueDim(null)
          if (zone === 'row') setRowDim(k)
          else if (zone === 'col') setColDim(k)
          else setValueDim(k)
          setDragOver(null)
        }}
        style={{
          border: `2px dashed ${isOver ? 'var(--brand)' : 'var(--border-default)'}`,
          borderRadius: '10px', padding: '8px 12px', minHeight: '44px',
          display: 'flex', alignItems: 'center', gap: '8px',
          background: isOver ? 'var(--brand-sky-50)' : 'var(--bg-sunken)',
          transition: 'all 0.15s', cursor: 'default',
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}:</span>
        {dim ? (
          <span style={{ background: 'var(--brand)', color: 'white', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', fontWeight: 400, display: 'flex', alignItems: 'center', gap: '6px' }}>
            {zone === 'val' ? (dim.key === 'count' ? 'כמות לידים' : `ספירת ${dim.label}`) : dim.label}
            <button onClick={clear}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, fontFamily: 'inherit' }}>x</button>
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--fg-4)' }}>גרור שדה לכאן</span>
        )}
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '20px' }}>
      <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '16px' }}>
        טבלת ניתוח — גרור שדות
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px', marginBottom: '20px', alignItems: 'start' }}>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            שדות זמינים
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {available.map(dim => (
              <div key={dim.key} draggable onDragStart={e => e.dataTransfer.setData('dimKey', dim.key)}
                style={{
                  padding: '7px 12px', background: 'var(--bg-hover)',
                  borderRadius: '8px', fontSize: '13px', fontWeight: 400,
                  color: 'var(--fg-2)', cursor: 'grab', border: '1.5px solid var(--border-subtle)',
                  userSelect: 'none', display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                <span style={{ opacity: 0.4, fontSize: '10px' }}>⠿</span>
                {dim.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <DropZone zone="row" label="שורות"  current={rowDim} />
          <DropZone zone="col" label="עמודות" current={colDim} />
          <DropZone zone="val" label="ערכים"  current={valueDim} />
          {valueDim && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingRight: '4px' }}>
              {VALUE_TYPES.map(vt => (
                <button key={vt.key} onClick={() => setValueType(vt.key)}
                  style={{
                    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 400,
                    cursor: 'pointer', border: 'none', fontFamily: 'inherit', transition: 'all 0.15s',
                    background: valueType === vt.key ? 'var(--brand-leaf-500)' : 'var(--bg-hover)',
                    color: valueType === vt.key ? 'white' : 'var(--fg-3)',
                  }}>{vt.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {rowDim && rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-sunken)', borderBottom: '2px solid var(--border-default)' }}>
                <th style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--fg-3)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {PIVOT_DIMS.find(d => d.key === rowDim)?.label}
                  {colDim && ` / ${PIVOT_DIMS.find(d => d.key === colDim)?.label}`}
                </th>
                {cols.map(c => (
                  <th key={c} style={{ padding: '9px 14px', textAlign: 'center', color: 'var(--fg-3)', fontWeight: 500, whiteSpace: 'nowrap' }}>{c}</th>
                ))}
                <th style={{ padding: '9px 14px', textAlign: 'center', color: 'var(--fg-2)', fontWeight: 600, borderRight: '2px solid var(--border-default)' }}>סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowTotal = cols.reduce((s, c) => s + (data[row]?.[c] || 0), 0)
                return (
                  <tr key={row} style={{ borderBottom: '1px solid var(--border-subtle)', background: ri % 2 === 0 ? 'transparent' : 'var(--bg-sunken)' }}>
                    <td style={{ padding: '8px 14px', color: 'var(--fg-1)', fontWeight: 500 }}>{row}</td>
                    {cols.map(c => {
                      const val = data[row]?.[c] || 0
                      const max = Math.max(...rows.map(r => data[r]?.[c] || 0), 1)
                      return (
                        <td key={c} style={{
                          padding: '8px 14px', textAlign: 'center',
                          color: val ? 'var(--fg-1)' : 'var(--fg-4)', fontWeight: val ? 500 : 400,
                          background: val ? `rgba(63,169,220,${(val / max) * 0.18})` : 'transparent',
                        }}>{fmtCell(row, c)}</td>
                      )
                    })}
                    <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--brand)', borderRight: '2px solid var(--border-default)' }}>
                      {rowTotal}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '2px solid var(--border-default)', background: 'var(--bg-hover)' }}>
                <td style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--fg-1)' }}>סה"כ</td>
                {cols.map(c => {
                  const t = rows.reduce((s, r) => s + (data[r]?.[c] || 0), 0)
                  return <td key={c} style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 500, color: 'var(--fg-2)' }}>{t || '—'}</td>
                })}
                <td style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--fg-1)', borderRight: '2px solid var(--border-default)' }}>
                  {grandTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--fg-4)' }}>
          <p style={{ fontSize: '32px', marginBottom: '8px' }}>📋</p>
          <p style={{ fontSize: '14px', fontWeight: 400 }}>גרור שדה מהרשימה לאזור "שורות" כדי להתחיל</p>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>לדוגמא: חודש בשורות + מקור בעמודות</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today',  label: 'היום' },
  { key: 'week',   label: 'שבוע' },
  { key: 'month',  label: '30 יום' },
  { key: 'ytd',    label: 'מתחילת השנה' },
  { key: 'custom', label: 'טווח מותאם' },
]

const ALL_TREATMENTS = ['implant', 'restorative', 'veneers', 'whitening', 'orthodontics', 'checkup', 'other']

export default function AnalyticsPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('ytd')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [treatmentFilter, setTreatmentFilter] = useState('')

  useEffect(() => {
    supabase
      .from('leads')
      .select('*, profile:profiles!leads_assigned_to_fkey(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setLeads(data || []); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    let result = filterByPeriod(leads, period, dateFrom, dateTo)
    if (treatmentFilter) result = result.filter(l => l.treatment_type === treatmentFilter)
    return result
  }, [leads, period, dateFrom, dateTo, treatmentFilter])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--brand-sky-600),var(--brand-leaf-500))', margin: '0 auto 12px', opacity: 0.8 }} />
        <p style={{ color: 'var(--fg-4)', fontSize: '14px' }}>טוען נתונים...</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 500, color: 'var(--fg-2)' }}>ניתוח ביצועים</h1>
        <p style={{ color: 'var(--fg-4)', fontSize: '13px', marginTop: '3px' }}>
          {filtered.length} לידים בתקופה הנבחרת, מתוך {leads.length} סה"כ
        </p>
      </div>

      {/* Period + treatment filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            style={{
              padding: '7px 16px', borderRadius: '8px', fontSize: '13px',
              fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              border: '1.5px solid',
              background: period === p.key ? 'var(--brand)' : 'var(--bg-surface)',
              color: period === p.key ? 'white' : 'var(--fg-2)',
              borderColor: period === p.key ? 'var(--brand)' : 'var(--border-default)',
              transition: 'all 0.15s',
            }}
          >{p.label}</button>
        ))}
        {period === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base" style={{ width: '150px' }} />
            <span style={{ color: 'var(--fg-4)', fontSize: '12px' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base" style={{ width: '150px' }} />
          </div>
        )}
        {/* Treatment filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px', borderRight: '1px solid var(--border-subtle)', paddingRight: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--fg-3)', fontWeight: 500 }}>סוג טיפול:</span>
          <select value={treatmentFilter} onChange={e => setTreatmentFilter(e.target.value)}
            className="input-base" style={{ fontSize: '12px', paddingTop: '6px', paddingBottom: '6px', minWidth: '130px' }}>
            <option value="">הכל</option>
            {ALL_TREATMENTS.map(t => (
              <option key={t} value={t}>{TREATMENT_LABELS[t]}</option>
            ))}
          </select>
          {treatmentFilter && (
            <button onClick={() => setTreatmentFilter('')}
              style={{ fontSize: '11px', color: '#EF4444', cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit' }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Funnel + stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '20px', marginBottom: '20px', alignItems: 'start' }}>

        {/* Funnel */}
        <div className="card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '16px' }}>
            משפך מכירות
            {treatmentFilter && (
              <span style={{ marginRight: '8px', fontSize: '11px', color: TREATMENT_COLORS[treatmentFilter] || 'var(--fg-3)', fontWeight: 400 }}>
                — {TREATMENT_LABELS[treatmentFilter]}
              </span>
            )}
          </h2>
          {filtered.length > 0 ? (
            <FunnelChart leads={filtered} />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--fg-4)' }}>
              <p>אין לידים בתקופה הנבחרת</p>
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {[
            { label: 'סה"כ לידים',  value: filtered.length,                                                color: 'var(--brand)', sub: 'בתקופה' },
            { label: 'לידים חמים',  value: filtered.filter(l => l.temperature === 'hot').length,           color: '#DC2626',       sub: `${filtered.length ? Math.round(filtered.filter(l => l.temperature === 'hot').length / filtered.length * 100) : 0}% מהסך הכל` },
            { label: 'נסגרו',       value: filtered.filter(l => l.status === 'closed').length,             color: '#059669',       sub: `${filtered.length ? Math.round(filtered.filter(l => l.status === 'closed').length / filtered.length * 100) : 0}% המרה` },
            { label: 'בטיפול',      value: filtered.filter(l => ['new','contacted','in_progress'].includes(l.status)).length, color: '#D97706', sub: 'מצריכים מעקב' },
            { label: 'לא רלוונטי', value: filtered.filter(l => l.status === 'not_relevant').length,        color: '#6B7280',       sub: 'אבדו' },
            { label: 'לידים קרים', value: filtered.filter(l => l.temperature === 'cold').length,           color: '#3B82F6',       sub: 'טמפרטורה נמוכה' },
          ].map(stat => (
            <div key={stat.label} className="card" style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 400, marginBottom: '6px' }}>{stat.label}</p>
              <p style={{ fontSize: '26px', fontWeight: 300, color: stat.color, lineHeight: 1 }}>{stat.value}</p>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '5px' }}>{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Treatment distribution chart */}
      <TreatmentDistribution leads={filtered} />

      {/* Pivot table */}
      <PivotTable leads={filtered} />

    </div>
  )
}
