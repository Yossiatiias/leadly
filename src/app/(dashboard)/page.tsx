'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SOURCE_LABELS, SOURCE_COLORS, type LeadSource, getDisplayName } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, CheckCircle2, ArrowUp, TrendingUp, AlertCircle, Star, Zap, FileText, RefreshCw, Moon, Bot, Sparkles } from 'lucide-react'

/* גווני קלפי התובנות — עובדים גם במצב כהה דרך משתני הערכה */
const INSIGHT_TONES = {
  good: { bg: 'var(--success-soft)', border: 'var(--success-border, #BBF7D0)', icon: 'var(--success)', iconBg: 'rgba(15,158,123,0.14)', text: 'var(--fg-1)' },
  warn: { bg: 'var(--danger-soft)',  border: 'var(--danger-border, #FECACA)',  icon: 'var(--danger)',  iconBg: 'rgba(232,75,60,0.14)',  text: 'var(--fg-1)' },
  info: { bg: 'var(--info-soft)',    border: 'var(--info-border, #DDD6FE)',    icon: 'var(--info)',    iconBg: 'rgba(124,58,237,0.14)', text: 'var(--fg-1)' },
} as const

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
  const [appointments, setAppointments] = useState<any[]>([])
  const [userName, setUserName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: profileData }, { data: leadsData }, { data: profilesData }, { data: activitiesData }, { data: apptData }] = await Promise.all([
        supabase.from('profiles').select('full_name, business_id').eq('id', user!.id).single(),
        supabase.from('leads').select('*').is('deleted_at', null),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('lead_activities').select('*, lead:leads(name,first_name,last_name), profile:profiles(full_name)').order('created_at', { ascending: false }).limit(20),
        supabase.from('appointments').select('id, created_at, notes, status'),
      ])
      setUserName(profileData?.full_name || '')
      setAllLeads(leadsData || [])
      setProfiles(profilesData || [])
      setRecentActivities(activitiesData || [])
      setAppointments(apptData || [])
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

  // תורים בתקופה הנבחרת + כמה מהם נקבעו על ידי הבוט
  const apptStats = useMemo(() => {
    const start = getPeriodStart(period, dateFrom)
    const end   = getPeriodEnd(period, dateTo)
    const inPeriod = appointments.filter(a => {
      const d = new Date(a.created_at)
      if (start && d < start) return false
      if (end   && d > end)   return false
      return a.status !== 'cancelled'
    })
    const byBot = inPeriod.filter(a => (a.notes || '').includes('נקבע אוטומטית על ידי הבוט')).length
    return { total: inPeriod.length, byBot }
  }, [appointments, period, dateFrom, dateTo])

  const active = allLeads.filter(l => !['published', 'not_relevant', 'closed', 'lost'].includes(l.status))
  const today  = new Date(); today.setHours(0, 0, 0, 0)
  const newToday = allLeads.filter(l => new Date(l.created_at) >= today).length

  // ─── AI Insights from real data ────────────────────────────────────────────
  // כל תובנה נבנית רק מנתונים אמיתיים. אם אין מספיק נתונים — היא לא מוצגת.
  const insights = useMemo(() => {
    const list: {
      icon: any; tone: 'good' | 'warn' | 'info'; text: string
      breakdown?: { label: string; value: number; pct: number }[]
    }[] = []

    // 1. לידים שהגיעו מחוץ לשעות הפעילות — הערך הישיר של בוט 24/7
    const afterHours = periodLeads.filter(l => {
      const h = new Date(l.created_at).getHours()
      const day = new Date(l.created_at).getDay()
      return h < 9 || h >= 18 || day === 6 // לפני 9, אחרי 18, או שבת
    })
    if (periodLeads.length >= 3 && afterHours.length > 0) {
      const pct = Math.round((afterHours.length / periodLeads.length) * 100)
      list.push({
        icon: Moon, tone: 'good',
        text: `${afterHours.length} מתוך ${periodLeads.length} לידים הגיעו מחוץ לשעות הפעילות (${pct}%) — הסוכן תפס אותם 24/7, בלעדיו הם היו הולכים למתחרים`,
      })
    }

    // 2. תורים שהבוט קבע לבד
    if (apptStats.total > 0 && apptStats.byBot > 0) {
      const pct = Math.round((apptStats.byBot / apptStats.total) * 100)
      list.push({
        icon: Bot, tone: 'good',
        text: `${apptStats.byBot} מתוך ${apptStats.total} תורים נקבעו אוטומטית על ידי הסוכן (${pct}%) — זה משפיע ישירות על נפח התורים`,
      })
    }

    // 3. לידים שממתינים למענה — כולל פילוח סיבות
    const overdueLeads = active.filter(l => l.next_followup && new Date(l.next_followup) < new Date())
    if (overdueLeads.length > 0) {
      const reasons: Record<string, number> = {}
      overdueLeads.forEach(l => {
        const key = l.treatment_type ? (TREATMENT_LABELS[l.treatment_type] || l.treatment_type) : 'ללא סיבה'
        reasons[key] = (reasons[key] || 0) + 1
      })
      const breakdown = Object.entries(reasons)
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([label, value]) => ({ label, value, pct: Math.round((value / overdueLeads.length) * 100) }))
      list.push({
        icon: AlertCircle, tone: 'warn',
        text: `${overdueLeads.length} לידים ממתינים לחזרה — מענה מהיר מכפיל סיכויי המרה`,
        breakdown: breakdown.length > 1 ? breakdown : undefined,
      })
    }

    // 4. אחוז המרה בתקופה
    if (totalPeriod >= 3 && published > 0) {
      list.push({
        icon: TrendingUp, tone: 'good',
        text: `${published} מתוך ${totalPeriod} לידים קבעו תור (${convRate}%) — זה אחוז ההמרה שלכם בתקופה`,
      })
    }

    // 5. הטיפול המבוקש ביותר
    const treatCounts: Record<string, number> = {}
    periodLeads.forEach(l => { if (l.treatment_type) { treatCounts[l.treatment_type] = (treatCounts[l.treatment_type] || 0) + 1 } })
    const topTreat = Object.entries(treatCounts).sort((a, b) => b[1] - a[1])[0]
    if (topTreat && topTreat[1] > 1) {
      const pct = totalPeriod ? Math.round((topTreat[1] / totalPeriod) * 100) : 0
      list.push({
        icon: Zap, tone: 'info',
        text: `${topTreat[1]} לידים (${pct}%) פנו בנושא ${TREATMENT_LABELS[topTreat[0]] || topTreat[0]} — הטיפול המבוקש ביותר`,
      })
    }

    return list.slice(0, 3)
  }, [periodLeads, active, totalPeriod, published, convRate, apptStats])

  const statusData = [
    { label: 'חדש',         value: periodLeads.filter(l => l.status === 'new').length,          color: 'var(--brand)' },
    { label: 'ביצירת קשר', value: periodLeads.filter(l => l.status === 'contacted').length,     color: 'var(--warning)' },
    { label: 'בתהליך',     value: periodLeads.filter(l => l.status === 'in_progress').length,   color: '#8B5CF6' },
    { label: 'נקבע תור',   value: periodLeads.filter(l => l.status === 'published').length,     color: 'var(--success)' },
    { label: 'לא רלוונטי', value: periodLeads.filter(l => l.status === 'not_relevant').length,  color: 'var(--fg-4)' },
  ]

  // נבנה דינמית מכל מקורות הלידים המוגדרים (SOURCE_LABELS/SOURCE_COLORS ב-types)
  // כדי שקטגוריה חדשה (כמו פייסבוק/אינסטגרם) תופיע כאן אוטומטית בלי לגעת בקוד הזה
  const sourceData = (Object.keys(SOURCE_LABELS) as LeadSource[]).map(src => ({
    label: SOURCE_LABELS[src],
    value: periodLeads.filter(l => l.source === src).length,
    color: SOURCE_COLORS[src],
  }))

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
    <div className="mobile-tight-padding" style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto' }}>

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

      {/* AI Insights — קלפים זה לצד זה */}
      {insights.length > 0 && (
        <div className="animate-in stagger-1" style={{ marginBottom: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
            <Sparkles size={15} style={{ color: 'var(--brand)' }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--fg-1)' }}>תובנות AI</span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
            gap: '14px',
          }}>
            {insights.map((ins, i) => {
              const tone = INSIGHT_TONES[ins.tone]
              const Icon = ins.icon
              return (
                <div key={i} style={{
                  background: tone.bg, border: `1px solid ${tone.border}`,
                  borderRadius: '14px', padding: '16px 18px',
                  display: 'flex', gap: '13px', alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
                    background: tone.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={17} style={{ color: tone.icon }} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, color: tone.text, fontWeight: 500 }}>
                      {ins.text}
                    </p>

                    {ins.breakdown && (
                      <div style={{ marginTop: '10px', paddingTop: '9px', borderTop: `1px solid ${tone.border}`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {ins.breakdown.map(b => (
                          <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11.5px', color: tone.text, opacity: 0.75 }}>{b.label}</span>
                            <span style={{ fontSize: '11.5px', color: tone.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {b.value} ({b.pct}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
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
      <div className="grid-2col-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '20px' }}>
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

      <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', marginBottom: '16px' }}>
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
      <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
