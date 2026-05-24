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
const TEMP_LABELS: Record<string, string> = { hot: 'חם 🔥', medium: 'בינוני ⚡', cold: 'קר ❄️' }

// ─── Funnel stages ────────────────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'total',        label: 'לידים שהגיעו',  color: '#BE185D', filter: (l: Lead[]) => l },
  { key: 'new',          label: 'חדש',            color: '#166534', filter: (l: Lead[]) => l.filter(x => x.status === 'new') },
  { key: 'contacted',    label: 'בוצע קשר',       color: '#C2410C', filter: (l: Lead[]) => l.filter(x => x.status === 'contacted') },
  { key: 'in_progress',  label: 'בטיפול',          color: '#B45309', filter: (l: Lead[]) => l.filter(x => x.status === 'in_progress') },
  { key: 'hot',          label: 'ליד חם 🔥',       color: '#991B1B', filter: (l: Lead[]) => l.filter(x => x.temperature === 'hot') },
  { key: 'medium',       label: 'ליד בינוני',      color: '#92400E', filter: (l: Lead[]) => l.filter(x => x.temperature === 'medium') },
  { key: 'published',    label: 'נסגר ✅',          color: '#065F46', filter: (l: Lead[]) => l.filter(x => x.status === 'published') },
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
  if (period === 'year') {
    const ago = new Date(now.getTime() - 365 * 86400000)
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
  const stages = FUNNEL_STAGES.map(s => ({
    ...s, count: s.filter(leads).length,
  }))
  const total = stages[0].count || 1
  const W = 560
  const segH = 52
  const H = stages.length * segH

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: '560px', display: 'block', margin: '0 auto' }}>
        {stages.map((stage, i) => {
          const n = stages.length
          const y = i * segH
          const indent = (i / n) * (W * 0.36)
          const nextIndent = ((i + 1) / n) * (W * 0.36)
          const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0
          const points = [
            `${indent},${y}`,
            `${W - indent},${y}`,
            `${W - nextIndent},${y + segH - 2}`,
            `${nextIndent},${y + segH - 2}`,
          ].join(' ')

          return (
            <g key={stage.key}>
              <polygon points={points} fill={stage.color} />
              <text
                x={W / 2} y={y + segH / 2 + 5}
                textAnchor="middle" fill="white"
                style={{ fontSize: '12.5px', fontWeight: '700', fontFamily: 'Rubik, sans-serif' }}
              >
                {stage.label}
                {'  —  '}
                {stage.count}
                {'  ('}
                {pct}
                {'%)'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Pivot Table ──────────────────────────────────────────────────────────────
function PivotTable({ leads }: { leads: Lead[] }) {
  const [rowDim, setRowDim] = useState<string | null>('month')
  const [colDim, setColDim] = useState<string | null>('source')
  const [dragOver, setDragOver] = useState<string | null>(null)

  const usedKeys = new Set([rowDim, colDim].filter(Boolean) as string[])
  const available = PIVOT_DIMS.filter(d => !usedKeys.has(d.key))

  const { rows, cols, data } = useMemo(() => {
    if (!rowDim) return { rows: [] as string[], cols: [] as string[], data: {} as Record<string, Record<string, number>> }
    const rowVals = [...new Set(leads.map(l => getDimValue(l, rowDim)))].sort()
    const colVals = colDim
      ? [...new Set(leads.map(l => getDimValue(l, colDim)))].sort()
      : ['סה״כ']
    const data: Record<string, Record<string, number>> = {}
    rowVals.forEach(r => { data[r] = {} })
    leads.forEach(lead => {
      const r = getDimValue(lead, rowDim)
      const c = colDim ? getDimValue(lead, colDim) : 'סה״כ'
      data[r][c] = (data[r][c] || 0) + 1
    })
    return { rows: rowVals, cols: colVals, data }
  }, [leads, rowDim, colDim])

  function DropZone({ zone, label, current }: { zone: 'row' | 'col'; label: string; current: string | null }) {
    const dim = PIVOT_DIMS.find(d => d.key === current)
    const isOver = dragOver === zone
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(zone) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => {
          e.preventDefault()
          const k = e.dataTransfer.getData('dimKey')
          if (zone === 'row') setRowDim(k)
          else setColDim(k)
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
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 700, whiteSpace: 'nowrap' }}>{label}:</span>
        {dim ? (
          <span style={{
            background: 'var(--brand)', color: 'white', borderRadius: '6px',
            padding: '3px 10px', fontSize: '12px', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            {dim.label}
            <button
              onClick={() => zone === 'row' ? setRowDim(null) : setColDim(null)}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, fontFamily: 'inherit' }}
            >×</button>
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--fg-4)' }}>גרור שדה לכאן</span>
        )}
      </div>
    )
  }

  const grandTotal = rows.reduce((s, r) => s + cols.reduce((ss, c) => ss + (data[r]?.[c] || 0), 0), 0)

  return (
    <div className="card" style={{ padding: '20px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '16px' }}>
        📊 טבלת ניתוח — גרור שדות
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px', marginBottom: '20px', alignItems: 'start' }}>
        {/* Field palette */}
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            שדות זמינים
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {available.map(dim => (
              <div
                key={dim.key}
                draggable
                onDragStart={e => e.dataTransfer.setData('dimKey', dim.key)}
                style={{
                  padding: '7px 12px', background: 'var(--bg-hover)',
                  borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  color: 'var(--fg-2)', cursor: 'grab', border: '1.5px solid var(--border-subtle)',
                  userSelect: 'none', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <span style={{ opacity: 0.4, fontSize: '10px' }}>⠿</span>
                {dim.label}
              </div>
            ))}
          </div>
        </div>

        {/* Drop zones */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <DropZone zone="row" label="שורות" current={rowDim} />
          <DropZone zone="col" label="עמודות" current={colDim} />
          <div style={{
            border: '2px solid var(--border-subtle)', borderRadius: '10px',
            padding: '8px 12px', background: 'var(--bg-sunken)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 700 }}>ערכים:</span>
            <span style={{
              background: 'var(--brand-leaf-500)', color: 'white', borderRadius: '6px',
              padding: '3px 10px', fontSize: '12px', fontWeight: 700,
            }}>ספירת לידים</span>
          </div>
        </div>
      </div>

      {/* Result table */}
      {rowDim && rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-sunken)', borderBottom: '2px solid var(--border-default)' }}>
                <th style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--fg-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {PIVOT_DIMS.find(d => d.key === rowDim)?.label}
                  {colDim && ` / ${PIVOT_DIMS.find(d => d.key === colDim)?.label}`}
                </th>
                {cols.map(c => (
                  <th key={c} style={{ padding: '9px 14px', textAlign: 'center', color: 'var(--fg-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{c}</th>
                ))}
                <th style={{ padding: '9px 14px', textAlign: 'center', color: 'var(--fg-2)', fontWeight: 700, borderRight: '2px solid var(--border-default)' }}>סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowTotal = cols.reduce((s, c) => s + (data[row]?.[c] || 0), 0)
                return (
                  <tr key={row} style={{ borderBottom: '1px solid var(--border-subtle)', background: ri % 2 === 0 ? 'transparent' : 'var(--bg-sunken)' }}>
                    <td style={{ padding: '8px 14px', color: 'var(--fg-1)', fontWeight: 600 }}>{row}</td>
                    {cols.map(c => {
                      const val = data[row]?.[c] || 0
                      const max = Math.max(...rows.map(r => data[r]?.[c] || 0), 1)
                      const intensity = val / max
                      return (
                        <td key={c} style={{
                          padding: '8px 14px', textAlign: 'center',
                          color: val ? 'var(--fg-1)' : 'var(--fg-4)',
                          fontWeight: val ? 600 : 400,
                          background: val ? `rgba(63,169,220,${intensity * 0.2})` : 'transparent',
                        }}>
                          {val || '—'}
                        </td>
                      )
                    })}
                    <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--brand)', borderRight: '2px solid var(--border-default)' }}>
                      {rowTotal}
                    </td>
                  </tr>
                )
              })}
              {/* Totals row */}
              <tr style={{ borderTop: '2px solid var(--border-default)', background: 'var(--bg-hover)' }}>
                <td style={{ padding: '9px 14px', fontWeight: 800, color: 'var(--fg-1)' }}>סה״כ</td>
                {cols.map(c => {
                  const t = rows.reduce((s, r) => s + (data[r]?.[c] || 0), 0)
                  return <td key={c} style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--fg-2)' }}>{t}</td>
                })}
                <td style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 800, color: 'var(--fg-1)', borderRight: '2px solid var(--border-default)' }}>
                  {grandTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--fg-4)' }}>
          <p style={{ fontSize: '32px', marginBottom: '8px' }}>📋</p>
          <p style={{ fontSize: '14px', fontWeight: 600 }}>גרור שדה מהרשימה לאזור "שורות" כדי להתחיל</p>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>לדוגמא: חודש בשורות + מקור בעמודות</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'today', label: 'היום' },
  { key: 'week',  label: 'שבוע' },
  { key: 'month', label: '30 יום' },
  { key: 'ytd',   label: 'מתחיל השנה' },
  { key: 'year',  label: 'שנה שלמה' },
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
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--brand-sky-600),var(--brand-leaf-500))', margin: '0 auto 12px', opacity: 0.8 }} className="animate-pulse-soft" />
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
          {filtered.length} לידים בתקופה הנבחרת, מתוך {leads.length} סה״כ
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
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
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
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '16px' }}>
            🔻 משפך מכירות
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
            { label: 'סה״כ לידים', value: filtered.length, color: 'var(--brand)', sub: 'בתקופה' },
            { label: 'לידים חמים', value: filtered.filter(l => l.temperature === 'hot').length, color: '#DC2626', sub: `${filtered.length ? Math.round(filtered.filter(l => l.temperature === 'hot').length / filtered.length * 100) : 0}% מהסך הכל` },
            { label: 'נסגרו', value: filtered.filter(l => l.status === 'published').length, color: '#059669', sub: `${filtered.length ? Math.round(filtered.filter(l => l.status === 'published').length / filtered.length * 100) : 0}% המרה` },
            { label: 'בטיפול', value: filtered.filter(l => ['new','contacted','in_progress'].includes(l.status)).length, color: '#D97706', sub: 'מצריכים מעקב' },
            { label: 'לא רלוונטי', value: filtered.filter(l => l.status === 'not_relevant').length, color: '#6B7280', sub: 'אבדו' },
            { label: 'לידים קרים', value: filtered.filter(l => l.temperature === 'cold').length, color: '#3B82F6', sub: 'טמפרטורה נמוכה' },
          ].map(stat => (
            <div key={stat.label} className="card" style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600, marginBottom: '6px' }}>{stat.label}</p>
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
