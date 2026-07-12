'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SOURCE_LABELS, getDisplayName } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, CheckCircle2, ArrowUp, TrendingUp, AlertCircle, Star, Zap, FileText, RefreshCw } from 'lucide-react'

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
    <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-subtle)', padding: '18px 20px' }}>
      <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--fg-4)', marginBottom: '8px', letterSpacing: '0.03em' }}>{label}</p>
      <p style={{ fontSize: '26px', fontWeight: 500, color, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '6px' }}>{sub}</p>}
    </div>
  )
}

const PERIOD_OPTIONS = [
  { key: 'day',   label: 'יום' },
  { key: 'week',  label: 'שבוע' },
  { key: 'month', label: 'חודש' },
  { key: 'range', label: 'טווח' },
]

const TREATMENT_LABELS: Record<string, string> = {
  implant: 'השתלות', restorative: 'טיפול משמר', veneers: 'ציפויים',
  whitening: 'הלבנה', orthodontics: 'יישור שיניים', checkup: 'בדיקה ואבחון', other: 'אחר',
}

const ACTIVITY_TYPE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  call:          { label: 'שיחה',         color: 'var(--success)',  icon: Phone },
  whatsapp:      { label: 'וואטסאפ',      color: '#0F9E7B',        icon: MessageCircle },
  note:          { label: 'הערה',         color: 'var(--brand)',    icon: FileText },
  status_change: { label: 'שינוי סטטוס',  color: 'var(--info)',     icon: RefreshCw },
}

export default function DashboardPage() {
  const supabase = createClient()
  const [allLeads, setAllLeads] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [recentActivities, setRecentActivities] = useState<any[]>([])
  const [userName, setUserName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: profileData }, { data: leadsData }, { data: profilesData }, { data: activitiesData }] = await Promise.all([
        supabase.from('profiles').select('full_name, business_id').eq('id', user!.id).single(),
        supabase.from('leads').select('*'),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('lead_activities').select('*, lead:leads(name,first_name,last_name), profile:profiles(full_name)').order('created_at', { ascending: false }).limit(20),
      ])
      setUserName(profileData?.full_name || '')
      setAllLeads(leadsData || [])
      setProfiles(profilesData || [])
      setRecentActivities(activitiesData || [])
      if (profileData?.business_id) {
        const { data: biz } = await supabase.from('businesses').select('name').eq('id', profileData.business_id).single()
        setBusinessName(biz?.name || '')
      }
      setLoading(false)
    }
    load()
  }, [])

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

  const totalPeriod = periodLeads.length
  const published   = periodLeads.filter(l => l.status === 'published').length
  const newLeads    = periodLeads.filter(l => l.status === 'new').length
  const inProgress  = periodLeads.filter(l => ['contacted', 'in_progress'].includes(l.status)).length
  const notRel      = periodLeads.filter(l => l.status === 'not_relevant').length
  const convRate    = totalPeriod ? Math.round((published / totalPeriod) * 100) : 0

  const active = allLeads.filter(l => !['published', 'not_relevant', 'closed', 'lost'].includes(l.status))
  const today  = new Date(); today.setHours(0, 0, 0, 0)
  const newToday = allLeads.filter(l => new Date(l.created_at) >= today).length

  // ─── AI Insights from real data ────────────────────────────────────────────
  const insights = useMemo(() => {
    const list: { icon: any; color: string; bg: string; title: string; body: string }[] = []

    // 1. Overdue leads alert
    const overdueLeads = active.filter(l => l.next_followup && new Date(l.next_followup) < new Date())
    if (overdueLeads.length > 0) {
      list.push({ icon: AlertCircle, color: 'var(--danger)', bg: 'var(--danger-soft)',
        title: `${overdueLeads.length} לידים עברו מועד טיפול`,
        body: `הלידים האלה דורשים מענה מיידי לפני שיתקררו` })
    }

    // 2. Conversion rate insight
    const weekAgo = new Date(Date.now() - 7 * 86400000)
    const thisWeek = allLeads.filter(l => new Date(l.created_at) >= weekAgo)
    const thisWeekConv = thisWeek.length ? Math.round((thisWeek.filter(l => l.status === 'published').length / thisWeek.length) * 100) : 0
    if (thisWeekConv > 0) {
      list.push({ icon: TrendingUp, color: 'var(--success)', bg: 'var(--success-soft)',
        title: `אחוז המרה השבוע: ${thisWeekConv}%`,
        body: `${thisWeek.filter(l => l.status === 'published').length} מתוך ${thisWeek.length} לידים השבוע קבעו תור` })
    }

    // 3. Best source this month
    const monthAgo = new Date(Date.now() - 30 * 86400000)
    const monthLeads = allLeads.filter(l => new Date(l.created_at) >= monthAgo)
    const sourceConvMap: Record<string, { total: number; pub: number }> = {}
    monthLeads.forEach(l => {
      if (!sourceConvMap[l.source]) sourceConvMap[l.source] = { total: 0, pub: 0 }
      sourceConvMap[l.source].total++
      if (l.status === 'published') sourceConvMap[l.source].pub++
    })
    let bestSource = '', bestRate = 0
    Object.entries(sourceConvMap).forEach(([src, { total, pub }]) => {
      const rate = total >= 3 ? Math.round((pub / total) * 100) : 0
      if (rate > bestRate) { bestRate = rate; bestSource = src }
    })
    if (bestSource && bestRate > 0) {
      list.push({ icon: Star, color: 'var(--warning)', bg: 'var(--warning-soft)',
        title: `מקור המרה מוביל: ${SOURCE_LABELS[bestSource as keyof typeof SOURCE_LABELS] || bestSource}`,
        body: `${bestRate}% המרה מלידים ממקור זה החודש` })
    }

    // 4. Top treatment type
    const treatCounts: Record<string, number> = {}
    periodLeads.forEach(l => { if (l.treatment_type) { treatCounts[l.treatment_type] = (treatCounts[l.treatment_type] || 0) + 1 } })
    const topTreat = Object.entries(treatCounts).sort((a, b) => b[1] - a[1])[0]
    if (topTreat && topTreat[1] > 1) {
      const pct = totalPeriod ? Math.round((topTreat[1] / totalPeriod) * 100) : 0
      list.push({ icon: Zap, color: 'var(--info)', bg: 'var(--info-soft)',
        title: `טיפול מבוקש: ${TREATMENT_LABELS[topTreat[0]] || topTreat[0]}`,
        body: `${topTreat[1]} לידים (${pct}%) מהתקופה מעוניינים בטיפול זה` })
    }

    return list.slice(0, 4)
  }, [allLeads, periodLeads, active, totalPeriod])

  const statusData = [
    { label: 'חדש',         value: periodLeads.filter(l => l.status === 'new').length,          color: 'var(--brand)' },
    { label: 'ביצירת קשר', value: periodLeads.filter(l => l.status === 'contacted').length,     color: 'var(--warning)' },
    { label: 'בתהליך',     value: periodLeads.filter(l => l.status === 'in_progress').length,   color: '#8B5CF6' },
    { label: 'נקבע תור',   value: periodLeads.filter(l => l.status === 'published').length,     color: 'var(--success)' },
    { label: 'לא רלוונטי', value: periodLeads.filter(l => l.status === 'not_relevant').length,  color: 'var(--fg-4)' },
  ]

  const sourceData = [
    { label: 'בקאופיס', value: periodLeads.filter(l => l.source === 'backoffice').length, color: 'var(--brand)' },
    { label: 'וואטסאפ', value: periodLeads.filter(l => l.source === 'whatsapp').length,   color: 'var(--success)' },
    { label: 'רשתות',   value: periodLeads.filter(l => l.source === 'social').length,     color: '#8B5CF6' },
    { label: 'יזום',    value: periodLeads.filter(l => l.source === 'outreach').length,   color: 'var(--warning)' },
    { label: 'ידני',    value: periodLeads.filter(l => l.source === 'manual').length,     color: 'var(--fg-4)' },
  ]

  const bySalesperson = profiles.map(p => ({
    name: p.full_name,
    initials: p.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?',
    active: allLeads.filter(l => l.assigned_to === p.id && !['published', 'not_relevant', 'closed', 'lost'].includes(l.status)).length,
    closed: allLeads.filter(l => l.assigned_to === p.id && l.status === 'published').length,
  }))

  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--brand)', margin: '0 auto 12px', opacity: 0.3, animation: 'pulse-soft 1.5s infinite' }} />
        <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען נתונים...</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div className="animate-in" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-4)', marginBottom: '4px' }}>
            {getGreeting()}, {userName.split(' ')[0]} 👋
          </p>
          <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--fg-1)', margin: 0, letterSpacing: '-0.03em', lineHeight: 1 }}>
            {businessName || 'הדשבורד שלי'}
          </h1>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontWeight: 600, color: 'var(--fg-2)', fontSize: '13px' }}>{dateStr}</p>
          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '2px' }}>
            {active.length === 0 ? '✅ כל הלידים מטופלים' : `${active.length} לידים פעילים`}
          </p>
        </div>
      </div>

      {/* AI Insights — 3 bold bullets */}
      {insights.length > 0 && (
        <div className="animate-in stagger-1" style={{ marginBottom: '20px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '18px 22px' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '14px' }}>
            ✦ תובנות AI
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {insights.slice(0, 3).map((ins, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: ins.color, marginTop: '5px', flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg-1)' }}>{ins.title}</span>
                  <span style={{ fontSize: '13px', color: 'var(--fg-3)' }}> — {ins.body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '8px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--fg-4)', marginLeft: '4px' }}>תקופה:</span>
        {PERIOD_OPTIONS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} style={{
            padding: '4px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit', border: 'none', transition: 'all 0.12s',
            background: period === p.key ? 'var(--brand)' : 'transparent',
            color: period === p.key ? 'white' : 'var(--fg-3)',
          }}>{p.label}</button>
        ))}
        {period === 'range' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base" style={{ width: '140px', fontSize: '12px', padding: '4px 8px' }} />
            <span style={{ color: 'var(--fg-4)', fontSize: '12px' }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base" style={{ width: '140px', fontSize: '12px', padding: '4px 8px' }} />
          </div>
        )}
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', marginRight: 'auto' }}>{totalPeriod} לידים</span>
      </div>

      {/* New today banner */}
      {newToday > 0 && (
        <div style={{ borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', background: 'var(--brand-soft)', border: '1px solid var(--blue-100)' }}>
          <ArrowUp size={13} style={{ color: 'var(--brand)' }} />
          <p style={{ color: 'var(--brand)', fontWeight: 600, fontSize: '13px' }}>{newToday} לידים חדשים הגיעו היום</p>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'סה״כ לידים בתקופה',  value: totalPeriod,       sub: `מתוך ${allLeads.length} במערכת`,          color: 'var(--brand)' },
          { label: 'לידים חדשים',         value: newLeads,           sub: 'ממתינים לטיפול',                          color: 'var(--fg-2)' },
          { label: 'בטיפול ומעקב',       value: inProgress,         sub: `${notRel} לא רלוונטיים`,                  color: 'var(--warning)' },
          { label: 'קבעו תור',            value: published,          sub: `${convRate}% מלידי התקופה`,               color: 'var(--success)' },
          { label: 'אחוזי המרה',          value: `${convRate}%`,     sub: `${published} נסגרו מ-${totalPeriod}`,     color: convRate >= 15 ? 'var(--success)' : 'var(--fg-2)' },
          { label: 'לידים פעילים',        value: active.length,      sub: 'כלל הזמן',                               color: 'var(--fg-2)' },
        ].map((k, i) => (
          <div key={k.label} className={`animate-in stagger-${i + 2}`}>
            <KpiCard label={k.label} value={k.value} sub={k.sub} color={k.color} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', marginBottom: '16px' }}>
        {/* Recent activity */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
            <h2 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '14px' }}>פעילות אחרונה</h2>
            <Link href="/leads" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--brand)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
              כל הלידים <ChevronLeft size={12} />
            </Link>
          </div>
          <div>
            {recentActivities.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <CheckCircle2 size={28} style={{ color: 'var(--fg-4)', margin: '0 auto 10px', display: 'block' }} />
                <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>אין פעילות עדיין</p>
              </div>
            ) : recentActivities.map((a, i) => {
              const conf = ACTIVITY_TYPE_CONFIG[a.type] || ACTIVITY_TYPE_CONFIG.note
              const Icon = conf.icon
              const leadName = a.lead ? getDisplayName(a.lead) : '—'
              const timeAgo = (() => {
                const diff = Date.now() - new Date(a.created_at).getTime()
                const m = Math.floor(diff / 60000)
                if (m < 60) return `לפני ${m} דק׳`
                const h = Math.floor(m / 60)
                if (h < 24) return `לפני ${h} ש׳`
                return `לפני ${Math.floor(h / 24)} ימים`
              })()
              return (
                <div key={a.id} style={{ padding: '11px 20px', borderBottom: i < recentActivities.length - 1 ? '1px solid var(--border-subtle)' : 'none', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: `${conf.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={13} style={{ color: conf.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--brand)', fontWeight: 600 }}>{leadName}</span>
                      {' — '}{a.action}
                    </p>
                    {a.details && <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.details}</p>}
                  </div>
                  <div style={{ textAlign: 'left', flexShrink: 0 }}>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)' }}>{timeAgo}</p>
                    {a.profile?.full_name && <p style={{ fontSize: '10px', color: 'var(--fg-4)', marginTop: '1px' }}>{a.profile.full_name}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Team */}
        <div className="card" style={{ padding: '18px 16px' }}>
          <h3 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', marginBottom: '14px' }}>הצוות</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bySalesperson.map(({ name, initials, active: a, closed }) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, color: 'var(--fg-1)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{a} פעילים</span>
                    {closed > 0 && <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>✓ {closed}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', marginBottom: '14px' }}>פילוח לפי סטטוס</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={statusData} size={120} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {statusData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--fg-3)', flex: 1 }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card" style={{ padding: '18px 20px' }}>
          <h3 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', marginBottom: '14px' }}>פילוח לפי מקור</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={sourceData} size={120} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {sourceData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
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
