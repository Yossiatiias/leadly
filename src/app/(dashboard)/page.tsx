'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPriorityScore, STATUS_CONFIG, SOURCE_LABELS } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, CheckCircle2, ArrowUp } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  return 'ערב טוב'
}

function getPeriodStart(period: string, dateFrom: string): Date | null {
  const now = new Date()
  if (period === 'day')   { const d = new Date(); d.setHours(0,0,0,0); return d }
  if (period === 'week')  return new Date(now.getTime() - 7  * 86400000)
  if (period === 'month') return new Date(now.getTime() - 30 * 86400000)
  if (period === 'range' && dateFrom) return new Date(dateFrom)
  return null
}

function getPeriodEnd(period: string, dateTo: string): Date | null {
  if (period === 'range' && dateTo) {
    const d = new Date(dateTo); d.setHours(23, 59, 59, 999); return d
  }
  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function DonutChart({ slices, size = 120 }: { slices: { value: number; color: string; label: string }[]; size?: number }) {
  const total = slices.reduce((s, d) => s + d.value, 0) || 1
  const r = size / 2 - 14
  const cx = size / 2, cy = size / 2
  let angle = -Math.PI / 2
  const paths = slices.map(({ value, color, label }) => {
    const pct = value / total
    const startAngle = angle
    angle += pct * 2 * Math.PI
    if (pct === 0) return null
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(angle),      y2 = cy + r * Math.sin(angle)
    const large = pct > 0.5 ? 1 : 0
    return <path key={label} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={color} opacity={0.9} />
  })
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r + 6} fill="var(--bg-hover)" />
      {paths}
      <circle cx={cx} cy={cy} r={r - 16} fill="var(--bg-surface)" />
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: '16px', fontWeight: 400, fill: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}>{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontSize: '9px', fontWeight: 400, fill: 'var(--fg-3)', fontFamily: 'var(--font-sans)' }}>לידים</text>
    </svg>
  )
}

function KpiCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', border: '1px solid var(--border-subtle)', padding: '20px 22px', boxShadow: '0 1px 3px rgba(17,24,39,0.05)' }}>
      <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--fg-4)', marginBottom: '10px' }}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: 400, color, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '8px', fontWeight: 400 }}>{sub}</p>}
    </div>
  )
}

const PERIOD_OPTIONS = [
  { key: 'day',   label: 'יום' },
  { key: 'week',  label: 'שבוע' },
  { key: 'month', label: 'חודש' },
  { key: 'range', label: 'טווח' },
]

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const supabase = createClient()
  const [allLeads, setAllLeads] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: profileData }, { data: leadsData }, { data: profilesData }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', user!.id).single(),
        supabase.from('leads').select('*, profile:profiles!leads_assigned_to_fkey(full_name)'),
        supabase.from('profiles').select('id, full_name'),
      ])
      setUserName(profileData?.full_name || '')
      setAllLeads(leadsData || [])
      setProfiles(profilesData || [])
      setLoading(false)
    }
    load()
  }, [])

  // ─── Filter leads by period ──────────────────────────────────────────────
  const periodLeads = useMemo(() => {
    const start = getPeriodStart(period, dateFrom)
    const end   = getPeriodEnd(period, dateTo)
    return allLeads.filter(l => {
      const d = new Date(l.created_at)
      if (start && d < start) return false
      if (end   && d > end)   return false
      return true
    })
  }, [allLeads, period, dateFrom, dateTo])

  // ─── KPI calculations (based on period) ─────────────────────────────────
  const totalPeriod  = periodLeads.length
  const newLeads     = periodLeads.filter(l => l.status === 'new').length
  const inProgress   = periodLeads.filter(l => ['contacted', 'in_progress'].includes(l.status)).length
  const published    = periodLeads.filter(l => l.status === 'published').length
  const notRelevant  = periodLeads.filter(l => l.status === 'not_relevant').length
  const convRate     = totalPeriod ? Math.round((published / totalPeriod) * 100) : 0

  // ─── Priority queue (all active, not filtered by period) ────────────────
  const active     = allLeads.filter(l => !['published', 'not_relevant'].includes(l.status))
  const priorities = [...active].sort((a, b) => getPriorityScore(b) - getPriorityScore(a)).slice(0, 8)
  const overdueCount = active.filter(l => l.next_followup && new Date(l.next_followup) < new Date()).length

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const newToday = allLeads.filter(l => new Date(l.created_at) >= today).length

  // ─── Charts data ─────────────────────────────────────────────────────────
  const statusData = [
    { label: 'חדש',         value: periodLeads.filter(l => l.status === 'new').length,          color: '#3FA9DC' },
    { label: 'ביצירת קשר', value: periodLeads.filter(l => l.status === 'contacted').length,     color: '#E89B17' },
    { label: 'בתהליך',     value: periodLeads.filter(l => l.status === 'in_progress').length,   color: '#8DCB3F' },
    { label: 'נסגר',       value: periodLeads.filter(l => l.status === 'published').length,     color: '#547F23' },
    { label: 'לא רלוונטי', value: periodLeads.filter(l => l.status === 'not_relevant').length,  color: '#B5BDC8' },
  ]

  const sourceData = [
    { label: 'בקאופיס', value: periodLeads.filter(l => l.source === 'backoffice').length, color: '#3FA9DC' },
    { label: 'וואטסאפ', value: periodLeads.filter(l => l.source === 'whatsapp').length,   color: '#8DCB3F' },
    { label: 'רשתות',   value: periodLeads.filter(l => l.source === 'social').length,     color: '#226F94' },
    { label: 'יזום',    value: periodLeads.filter(l => l.source === 'outreach').length,   color: '#E89B17' },
    { label: 'ידני',    value: periodLeads.filter(l => l.source === 'manual').length,     color: '#B5BDC8' },
  ]

  const bySalesperson = profiles.map(p => ({
    name: p.full_name,
    initials: p.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?',
    active: allLeads.filter(l => l.assigned_to === p.id && !['published', 'not_relevant'].includes(l.status)).length,
    closed: allLeads.filter(l => l.assigned_to === p.id && l.status === 'published').length,
  }))

  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-3)', marginBottom: '3px' }}>{getGreeting()}, {userName.split(' ')[0]} 👋</p>
          <h1 style={{ fontSize: '22px', fontWeight: 500, color: 'var(--fg-2)' }}>התחל כאן</h1>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px' }}>{dateStr}</p>
          <p style={{ fontSize: '12px', color: 'var(--fg-3)', marginTop: '2px' }}>
            {active.length === 0 ? '✅ כל הלידים מטופלים' : `${active.length} לידים פעילים`}
          </p>
        </div>
      </div>

      {/* Period selector */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: '12px', padding: '10px 16px', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--fg-3)', marginLeft: '4px' }}>הצג נתונים עבור:</span>
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: '5px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit', border: 'none', transition: 'all 0.15s',
              background: period === p.key ? 'var(--brand)' : 'var(--bg-hover)',
              color: period === p.key ? 'white' : 'var(--fg-2)',
            }}
          >{p.label}</button>
        ))}
        {period === 'range' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="input-base" style={{ width: '140px', fontSize: '12px', padding: '4px 8px' }} />
            <span style={{ color: 'var(--fg-4)', fontSize: '12px' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="input-base" style={{ width: '140px', fontSize: '12px', padding: '4px 8px' }} />
          </div>
        )}
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', marginRight: 'auto' }}>
          {totalPeriod} לידים בתקופה הנבחרת
        </span>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        <KpiCard label="סה״כ לידים לתקופה"    value={totalPeriod}        sub={`מתוך ${allLeads.length} סה״כ במערכת`}                      color="#226F94" />
        <KpiCard label="לידים חדשים"           value={newLeads}           sub="ממתינים לטיפול ראשוני"                                       color="#1D4ED8" />
        <KpiCard label="לידים בטיפול ומעקב"   value={inProgress}         sub={overdueCount > 0 ? `⚠ ${overdueCount} עברו מועד` : 'מטופלים'} color="#B87A0E" />
        <KpiCard label="לידים שנסגרו"          value={published}          sub={`${convRate}% מלידי התקופה`}                                  color="#15803D" />
        <KpiCard label="לא רלוונטיים"          value={notRelevant}        sub="מרחק / אין שירות מתאים"                                       color="#6B7280" />
        <KpiCard label="אחוזי המרה"            value={`${convRate}%`}     sub={`${published} נסגרו מתוך ${totalPeriod}`}                     color="#547F23" />
      </div>

      {newToday > 0 && (
        <div style={{ borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px', background: 'var(--brand-sky-50)', border: '1px solid var(--brand-sky-100)' }}>
          <ArrowUp size={14} style={{ color: 'var(--brand-sky-700)' }} />
          <p style={{ color: 'var(--brand-sky-700)', fontWeight: 600, fontSize: '13px' }}>{newToday} לידים חדשים הגיעו היום</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* Priority queue */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h2 style={{ fontWeight: 500, color: 'var(--fg-2)', fontSize: '14px' }}>סדר עדיפויות</h2>
              <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginTop: '2px' }}>מדורגים לפי דחיפות אוטומטית</p>
            </div>
            <Link href="/leads" style={{ fontSize: '12px', fontWeight: 700, color: '#3730A3', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
              כל הלידים <ChevronLeft size={12} />
            </Link>
          </div>
          <div>
            {priorities.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <CheckCircle2 size={32} style={{ color: '#E5E7EB', margin: '0 auto 10px' }} />
                <p style={{ color: 'var(--fg-4)', fontWeight: 600, fontSize: '13px' }}>אין לידים פעילים כרגע</p>
              </div>
            ) : priorities.map((lead, i) => {
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date()
              const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0
              return (
                <div key={lead.id} style={{ padding: '12px 20px', borderBottom: i < priorities.length - 1 ? '1px solid var(--border-subtle)' : 'none', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 500, background: i === 0 ? '#3730A3' : 'var(--bg-hover)', color: i === 0 ? 'white' : 'var(--fg-3)' }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                      <Link href={`/leads/${lead.id}`} style={{ fontWeight: 500, color: 'var(--fg-1)', textDecoration: 'none', fontSize: '13px' }}>{lead.name}</Link>
                      {lead.company_name && <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>· {lead.company_name}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}</span>
                      {isOverdue && daysOverdue > 0 && <span style={{ fontSize: '11px', fontWeight: 400, color: '#EF4444' }}>⚠ {daysOverdue} ימים ללא טיפול</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)', textDecoration: 'none' }}>
                        <Phone size={12} style={{ color: '#15803D' }} />
                      </a>
                    )}
                    {lead.phone && (
                      <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`} target="_blank" style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)', textDecoration: 'none' }}>
                        <MessageCircle size={12} style={{ color: '#15803D' }} />
                      </a>
                    )}
                    <Link href={`/leads/${lead.id}`} style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)', textDecoration: 'none' }}>
                      <ChevronLeft size={12} style={{ color: 'var(--fg-3)' }} />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side - Team */}
        <div className="card" style={{ padding: '18px' }}>
          <h3 style={{ fontWeight: 500, color: 'var(--fg-2)', fontSize: '13px', marginBottom: '14px' }}>הצוות</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bySalesperson.map(({ name, initials, active: a, closed }) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-1)', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, color: 'var(--fg-2)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{a} פעילים</span>
                    {closed > 0 && <span style={{ fontSize: '11px', color: '#15803D' }}>✅ {closed}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontWeight: 500, color: 'var(--fg-2)', fontSize: '13px', marginBottom: '16px' }}>פילוח לפי סטטוס</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={statusData} size={130} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {statusData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--fg-3)', flex: 1 }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontWeight: 500, color: 'var(--fg-2)', fontSize: '13px', marginBottom: '16px' }}>פילוח לפי מקור</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={sourceData} size={130} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sourceData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--fg-3)', flex: 1 }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
