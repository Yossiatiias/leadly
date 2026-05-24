'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id: string
  name: string
  status: string
  temperature: string
  source: string
  assigned_to: string | null
  created_at: string
  profile?: { full_name: string } | null
}

// ─── Labels ───────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  new: 'חדש', contacted: 'בוצע קשר', in_progress: 'בטיפול',
  published: 'נסגר', not_relevant: 'לא רלוונטי',
}
const SOURCE_LABELS: Record<string, string> = {
  backoffice: 'בקאופיס', whatsapp: 'וואטסאפ', social: 'רשתות',
  outreach: 'יזום', manual: 'ידני',
}
const TEMP_LABELS: Record<string, string> = { hot: 'חם', medium: 'בינוני', cold: 'קר' }

// ─── Funnel stages ────────────────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'total',        label: 'לידים שהגיעו',  color: '#BE185D', filter: (l: Lead[]) => l },
  { key: 'new',          label: 'חדש',            color: '#166534', filter: (l: Lead[]) => l.filter(x => x.status === 'new') },
  { key: 'contacted',    label: 'בוצע קשר',       color: '#C2410C', filter: (l: Lead[]) => l.filter(x => x.status === 'contacted') },
  { key: 'in_progress',  label: 'בטיפול',          color: '#B45309', filter: (l: Lead[]) => l.filter(x => x.status === 'in_progress') },
  { key: 'hot',          label: 'ליד חם',          color: '#991B1B', filter: (l: Lead[]) => l.filter(x => x.temperature === 'hot') },
  { key: 'medium',       label: 'ליד בינוני',      color: '#92400E', filter: (l: Lead[]) => l.filter(x => x.temperature === 'medium') },
  { key: 'published',    label: 'נסגר',            color: '#065F46', filter: (l: Lead[]) => l.filter(x => x.status === 'published') },
  { key: 'not_relevant', label: 'לא רלוונטי',      color: '#4B5563', filter: (l: Lead[]) => l.filter(x => x.status === 'not_relevant') },
]

// ─── Pivot dimensions ─────────────────────────────────────────────────────────
const PIVOT_DIMS = [
  { key: 'month',       label: 'חודש' },
  { key: 'year',        label: 'שנה' },
  { key: 'week',        label: 'שבוע' },
  { key: 'quarter',     label: 'רבעון' },
  { key: 'source',      label: 'מקור' },
  { key: 'status',      label: 'סטטוס' },
  { key: 'temperature', label: 'טמפרטורה' },
  { key: 'assigned',    label: 'איש מכירות' },
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
    case 'quarter': return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`
    case 'source':      return SOURCE_LABELS[lead.source] || lead.source
    case 'status':      return STATUS_LABELS[lead.status] || lead.status
    case 'temperature': return TEMP_LABELS[lead.temperature] || lead.temperature
    case 'assigned':    return lead.profile?.full_name || 'לא שויך'
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
  const stages = FUNNEL_STAGES.map(s => ({ ...s, count: s.filter(leads).length }))
  const total = stages[0].count || 1
  const W = 560
  const segH = 62
  const H = stages.length * segH

  return (
    <div style={{ overflowX: 'auto' }}>
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
          return (
            <g key={stage.key} filter="url(#txt-shadow)">
              <polygon points={points} fill={stage.color} />
              <text x={W / 2} y={cy - 5} textAnchor="middle" fill="white"
                style={{ fontSize: '15px', fontWeight: '400', fontFamily: 'Rubik, sans-serif' }}>{stage.label}</text>
              <text x={W / 2} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.85)"
                style={{ fontSize: '13px', fontWeight: '300', fontFamily: 'Rubik, sans-serif' }}>{stage.count} לידים ({pct}%)</text>
            </g>
          )
        })}
      </svg>
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
  const [rowDim,    setRowDim]    = useState<string | null>('assigned')
  const [colDim,    setColDim]    = useState<string | null>('month')
  const [filterDim, setFilterDim] = useState<string | null>(null)
  const [filterVal, setFilterVal] = useState<string>('')
  const [valueType, setValueType] = useState<string>('count')
  const [dragOver,  setDragOver]  = useState<string | null>(null)

  function handleCheckbox(key: string) {
    if (rowDim    === key) return setRowDim(null)
    if (colDim    === key) return setColDim(null)
    if (filterDim === key) { setFilterDim(null); return setFilterVal('') }
    if (!rowDim)    return setRowDim(key)
    if (!colDim)    return setColDim(key)
    if (!filterDim) return setFilterDim(key)
  }

  function onDrop(zone: 'row' | 'col' | 'filter') {
    return (e: React.DragEvent) => {
      e.preventDefault()
      const key = e.dataTransfer.getData('dimKey')
      if (!key) return
      if (rowDim    === key) setRowDim(null)
      if (colDim    === key) setColDim(null)
      if (filterDim === key) { setFilterDim(null); setFilterVal('') }
      if (zone === 'row')    setRowDim(key)
      if (zone === 'col')    setColDim(key)
      if (zone === 'filter') setFilterDim(key)
      setDragOver(null)
    }
  }

  function removeZone(zone: 'row' | 'col' | 'filter') {
    if (zone === 'row')    setRowDim(null)
    if (zone === 'col')    setColDim(null)
    if (zone === 'filter') { setFilterDim(null); setFilterVal('') }
  }

  const filteredLeads = useMemo(() => {
    if (!filterDim || !filterVal) return leads
    return leads.filter(l => getDimValue(l, filterDim) === filterVal)
  }, [leads, filterDim, filterVal])

  const filterOptions = useMemo(() => {
    if (!filterDim) return []
    return [...new Set(leads.map(l => getDimValue(l, filterDim)))].sort()
  }, [leads, filterDim])

  const { rows, cols, data } = useMemo(() => {
    if (!rowDim) return { rows: [] as string[], cols: [] as string[], data: {} as Record<string, Record<string, number>> }
    const rowVals = [...new Set(filteredLeads.map(l => getDimValue(l, rowDim)))].sort()
    const colVals = colDim ? [...new Set(filteredLeads.map(l => getDimValue(l, colDim)))].sort() : ['סה"כ']
    const d: Record<string, Record<string, number>> = {}
    rowVals.forEach(r => { d[r] = {} })
    filteredLeads.forEach(lead => {
      const r = getDimValue(lead, rowDim)
      const c = colDim ? getDimValue(lead, colDim) : 'סה"כ'
      d[r][c] = (d[r][c] || 0) + 1
    })
    return { rows: rowVals, cols: colVals, data: d }
  }, [filteredLeads, rowDim, colDim])

  const grandTotal = rows.reduce((s, r) => s + cols.reduce((ss, c) => ss + (data[r]?.[c] || 0), 0), 0)

  function fmtCell(r: string, c: string): string {
    const v = data[r]?.[c] || 0
    if (valueType === 'count')   return v ? String(v) : '—'
    if (valueType === 'pct_row') { const rt = cols.reduce((s, cc) => s + (data[r]?.[cc] || 0), 0); return rt ? `${Math.round(v / rt * 100)}%` : '—' }
    if (valueType === 'pct_col') { const ct = rows.reduce((s, rr) => s + (data[rr]?.[c] || 0), 0); return ct ? `${Math.round(v / ct * 100)}%` : '—' }
    if (valueType === 'pct_all') return grandTotal ? `${Math.round(v / grandTotal * 100)}%` : '—'
    return '—'
  }

  const selSt: React.CSSProperties = {
    width: '100%', padding: '5px 8px', borderRadius: '6px', outline: 'none',
    border: '1px solid var(--border-default)', fontSize: '12px',
    background: 'var(--bg-surface)', color: 'var(--fg-1)', fontFamily: 'inherit',
  }

  function ZoneBox({ zone, label, icon, current }: { zone: 'row' | 'col' | 'filter'; label: string; icon: string; current: string | null }) {
    const dim = PIVOT_DIMS.find(d => d.key === current)
    const over = dragOver === zone
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(zone) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop(zone)}
        style={{
          border: `1.5px dashed ${over ? 'var(--brand)' : 'var(--border-default)'}`,
          borderRadius: '8px', padding: '7px 8px', minHeight: '62px',
          background: over ? 'var(--brand-sky-50)' : 'var(--bg-surface)', transition: 'all 0.15s',
        }}
      >
        <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--fg-4)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ fontSize: '9px' }}>{icon}</span>{label}
        </p>
        {dim ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--brand)', borderRadius: '5px', padding: '3px 8px' }}>
            <span style={{ fontSize: '11px', color: 'white', fontWeight: 400, flex: 1 }}>{dim.label}</span>
            <button onClick={() => removeZone(zone)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 0, fontSize: '15px', lineHeight: 1, fontFamily: 'inherit' }}>
              x
            </button>
          </div>
        ) : (
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontStyle: 'italic' }}>גרור לכאן</p>
        )}
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--border-default)', borderRadius: '14px', overflow: 'hidden',
      display: 'flex', direction: 'rtl', background: 'var(--bg-surface)',
      boxShadow: '0 1px 4px rgba(20,23,28,0.06)',
    }}>

      {/* ── Field panel (right side in RTL) ── */}
      <div style={{ width: '238px', flexShrink: 0, borderLeft: '1px solid var(--border-default)', background: 'var(--bg-sunken)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)' }}>שדות PivotTable</p>
        </div>

        {/* Checkboxes */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginBottom: '8px' }}>בחר שדות להוסיף לדוח:</p>
          {PIVOT_DIMS.map(dim => {
            const inUse = [rowDim, colDim, filterDim].includes(dim.key)
            return (
              <label key={dim.key} draggable onDragStart={e => e.dataTransfer.setData('dimKey', dim.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={!!inUse} onChange={() => handleCheckbox(dim.key)}
                  style={{ accentColor: 'var(--brand)', width: '14px', height: '14px', cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: inUse ? 'var(--fg-1)' : 'var(--fg-3)', fontWeight: inUse ? 500 : 400 }}>
                  {dim.label}
                </span>
              </label>
            )
          })}
        </div>

        {/* 4 zones */}
        <div style={{ padding: '12px 16px', flex: 1 }}>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginBottom: '10px' }}>גרור שדות בין האזורים שלהלן:</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <ZoneBox zone="filter" label="מסננים" icon="▼" current={filterDim} />
            <ZoneBox zone="col"    label="עמודות"  icon="|||" current={colDim} />
            <ZoneBox zone="row"    label="שורות"   icon="=" current={rowDim} />
            <div style={{ border: '1.5px solid var(--border-default)', borderRadius: '8px', padding: '7px 8px', background: 'var(--bg-surface)', minHeight: '62px' }}>
              <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--fg-4)', marginBottom: '5px' }}>
                &#931; ערכים
              </p>
              <select value={valueType} onChange={e => setValueType(e.target.value)} style={selSt}>
                {VALUE_TYPES.map(vt => <option key={vt.key} value={vt.key}>{vt.label}</option>)}
              </select>
            </div>
          </div>

          {/* Filter value picker */}
          {filterDim && (
            <div>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginBottom: '5px' }}>
                {PIVOT_DIMS.find(d => d.key === filterDim)?.label}:
              </p>
              <select value={filterVal} onChange={e => setFilterVal(e.target.value)} style={selSt}>
                <option value="">הכל</option>
                {filterOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Table area (left side) ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px', minWidth: 0 }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '14px' }}>
          טבלת ניתוח
        </p>

        {!rowDim ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--fg-4)' }}>
            <p style={{ fontSize: '30px', marginBottom: '10px' }}>📋</p>
            <p style={{ fontSize: '14px', fontWeight: 400 }}>סמן שדה ברשימה מימין כדי להתחיל</p>
            <p style={{ fontSize: '12px', marginTop: '4px' }}>לדוגמא: סמן "איש מכירות" ו"חודש"</p>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--fg-4)', fontSize: '13px' }}>
            אין נתונים בתקופה הנבחרת
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-sunken)', borderBottom: '2px solid var(--border-default)' }}>
                <th style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--fg-3)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {PIVOT_DIMS.find(d => d.key === rowDim)?.label}
                  {colDim && ` \\ ${PIVOT_DIMS.find(d => d.key === colDim)?.label}`}
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
                        }}>
                          {fmtCell(row, c)}
                        </td>
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
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today', label: 'היום' },
  { key: 'week',  label: 'שבוע' },
  { key: 'month', label: '30 יום' },
  { key: 'ytd',   label: 'מתחילת השנה' },
  { key: 'custom', label: 'טווח מותאם' },
]

export default function AnalyticsPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('ytd')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    supabase
      .from('leads')
      .select('*, profile:profiles!leads_assigned_to_fkey(full_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setLeads(data || []); setLoading(false) })
  }, [])

  const filtered = useMemo(
    () => filterByPeriod(leads, period, dateFrom, dateTo),
    [leads, period, dateFrom, dateTo]
  )

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

      {/* Period selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
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
      </div>

      {/* Funnel + stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '20px', marginBottom: '20px', alignItems: 'start' }}>

        {/* Funnel */}
        <div className="card" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-2)', marginBottom: '16px' }}>
            משפך מכירות
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
            { label: 'סה"כ לידים',  value: filtered.length, color: 'var(--brand)', sub: 'בתקופה' },
            { label: 'לידים חמים',  value: filtered.filter(l => l.temperature === 'hot').length, color: '#DC2626', sub: `${filtered.length ? Math.round(filtered.filter(l => l.temperature === 'hot').length / filtered.length * 100) : 0}% מהסך הכל` },
            { label: 'נסגרו',       value: filtered.filter(l => l.status === 'published').length, color: '#059669', sub: `${filtered.length ? Math.round(filtered.filter(l => l.status === 'published').length / filtered.length * 100) : 0}% המרה` },
            { label: 'בטיפול',      value: filtered.filter(l => ['new','contacted','in_progress'].includes(l.status)).length, color: '#D97706', sub: 'מצריכים מעקב' },
            { label: 'לא רלוונטי', value: filtered.filter(l => l.status === 'not_relevant').length, color: '#6B7280', sub: 'אבדו' },
            { label: 'לידים קרים', value: filtered.filter(l => l.temperature === 'cold').length, color: '#3B82F6', sub: 'טמפרטורה נמוכה' },
          ].map(stat => (
            <div key={stat.label} className="card" style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 400, marginBottom: '6px' }}>{stat.label}</p>
              <p style={{ fontSize: '26px', fontWeight: 300, color: stat.color, lineHeight: 1 }}>{stat.value}</p>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '5px' }}>{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pivot table */}
      <PivotTable leads={filtered} />

    </div>
  )
}
