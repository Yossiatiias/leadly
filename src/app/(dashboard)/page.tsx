import { createClient } from '@/lib/supabase/server'
import { getPriorityScore, TEMP_CONFIG, STATUS_CONFIG, SOURCE_LABELS } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, Flame, Clock, TrendingUp, CheckCircle2, Users, ArrowUp } from 'lucide-react'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  return 'ערב טוב'
}

function HBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map(({ label, value, color }) => {
        const pct = Math.round((value / max) * 100)
        return (
          <div key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>{value}</span>
            </div>
            <div style={{ height: '7px', background: '#F3F4F6', borderRadius: '99px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`, background: color,
                borderRadius: '99px', transition: 'width 0.7s ease',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
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
    const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle)
    const large = pct > 0.5 ? 1 : 0
    return (
      <path key={label}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
        fill={color} opacity={0.9}
      />
    )
  })
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r + 6} fill="#F3F4F6" />
      {paths}
      <circle cx={cx} cy={cy} r={r - 16} fill="white" />
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: '16px', fontWeight: 800, fill: '#111827', fontFamily: 'Assistant, sans-serif' }}>{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontSize: '9px', fill: '#6B7280', fontFamily: 'Assistant, sans-serif' }}>לידים</text>
    </svg>
  )
}

function KpiCard({ label, value, sub, color, bg }: { label: string; value: number | string; sub?: string; color: string; bg: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #E5E7EB', padding: '18px 20px', boxShadow: '0 1px 4px rgba(17,24,39,0.04)' }}>
      <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>{label}</p>
      <p style={{ fontSize: '32px', fontWeight: 800, color, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>{sub}</p>}
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: allLeads }, { data: profile }, { data: profiles }] = await Promise.all([
    supabase.from('leads').select('*, profile:profiles!leads_assigned_to_fkey(full_name)'),
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase.from('profiles').select('*'),
  ])

  const leads = allLeads || []
  const active = leads.filter(l => !['published', 'not_relevant'].includes(l.status))
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const priorities = active
    .sort((a, b) => getPriorityScore(b) - getPriorityScore(a))
    .slice(0, 8)

  const hot = active.filter(l => l.temperature === 'hot').length
  const overdueCount = active.filter(l => l.next_followup && new Date(l.next_followup) < new Date()).length
  const newToday = leads.filter(l => new Date(l.created_at) >= today).length
  const published = leads.filter(l => l.status === 'published').length
  const convRate = leads.length ? Math.round((published / leads.length) * 100) : 0

  const statusData = [
    { label: 'חדש',         value: leads.filter(l => l.status === 'new').length,          color: '#3FA9DC' },
    { label: 'ביצירת קשר', value: leads.filter(l => l.status === 'contacted').length,     color: '#E89B17' },
    { label: 'בתהליך',     value: leads.filter(l => l.status === 'in_progress').length,   color: '#8DCB3F' },
    { label: 'פורסם',      value: leads.filter(l => l.status === 'published').length,     color: '#547F23' },
    { label: 'לא רלוונטי', value: leads.filter(l => l.status === 'not_relevant').length,  color: '#B5BDC8' },
  ]

  const sourceData = [
    { label: 'בקאופיס', value: leads.filter(l => l.source === 'backoffice').length, color: '#3FA9DC' },
    { label: 'וואטסאפ', value: leads.filter(l => l.source === 'whatsapp').length,   color: '#8DCB3F' },
    { label: 'רשתות',   value: leads.filter(l => l.source === 'social').length,     color: '#226F94' },
    { label: 'יזום',    value: leads.filter(l => l.source === 'outreach').length,   color: '#E89B17' },
    { label: 'ידני',    value: leads.filter(l => l.source === 'manual').length,     color: '#B5BDC8' },
  ]

  const bySalesperson = (profiles || []).map(p => ({
    name: p.full_name,
    initials: p.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?',
    hot: leads.filter(l => l.assigned_to === p.id && l.temperature === 'hot' && !['published', 'not_relevant'].includes(l.status)).length,
    active: leads.filter(l => l.assigned_to === p.id && !['published', 'not_relevant'].includes(l.status)).length,
    published: leads.filter(l => l.assigned_to === p.id && l.status === 'published').length,
  }))

  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ padding: '28px 28px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#6B7280', marginBottom: '3px' }}>{getGreeting()}, {profile?.full_name?.split(' ')[0]} 👋</p>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#111827' }}>התחל כאן</h1>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ fontWeight: 700, color: '#111827', fontSize: '14px' }}>{dateStr}</p>
          <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
            {active.length === 0 ? '✅ כל הלידים מטופלים' : `${active.length} לידים פעילים`}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px', marginBottom: '20px' }}>
        <KpiCard label="לידים פעילים" value={active.length} sub={`מתוך ${leads.length} סה״כ`} color="#226F94" bg="#EAF6FC" />
        <KpiCard label="לידים חמים" value={hot} sub={hot > 0 ? 'דורשים מענה מיידי' : 'אין כרגע'} color="#B83434" bg="#FEECEC" />
        <KpiCard label="ממתינים לטיפול" value={overdueCount} sub={overdueCount > 0 ? 'עבר מועד follow-up' : 'הכל מעודכן'} color="#B87A0E" bg="#FFF6E5" />
        <KpiCard label="אחוז המרה" value={`${convRate}%`} sub={`${published} פרסמו מתוך ${leads.length}`} color="#547F23" bg="#ECFAE5" />
      </div>

      {newToday > 0 && (
        <div style={{ borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px', background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
          <ArrowUp size={14} style={{ color: '#3730A3' }} />
          <p style={{ color: '#3730A3', fontWeight: 600, fontSize: '13px' }}>{newToday} לידים חדשים הגיעו היום</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* Priority queue */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6' }}>
            <div>
              <h2 style={{ fontWeight: 800, color: '#111827', fontSize: '14px' }}>סדר עדיפויות</h2>
              <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>מדורגים לפי דחיפות אוטומטית</p>
            </div>
            <Link href="/leads" style={{ fontSize: '12px', fontWeight: 700, color: '#3730A3', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
              כל הלידים <ChevronLeft size={12} />
            </Link>
          </div>
          <div>
            {priorities.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <CheckCircle2 size={32} style={{ color: '#E5E7EB', margin: '0 auto 10px' }} />
                <p style={{ color: '#9CA3AF', fontWeight: 600, fontSize: '13px' }}>אין לידים פעילים כרגע</p>
              </div>
            ) : priorities.map((lead, i) => {
              const temp = TEMP_CONFIG[lead.temperature as keyof typeof TEMP_CONFIG] || TEMP_CONFIG.medium
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date()
              const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0

              return (
                <div key={lead.id} style={{
                  padding: '12px 20px',
                  borderBottom: i < priorities.length - 1 ? '1px solid #F9FAFB' : 'none',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  transition: 'background 0.1s',
                }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 800,
                    background: i === 0 ? '#3730A3' : '#F3F4F6',
                    color: i === 0 ? 'white' : '#6B7280',
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                      <Link href={`/leads/${lead.id}`} style={{ fontWeight: 700, color: '#111827', textDecoration: 'none', fontSize: '13px' }}>
                        {lead.name}
                      </Link>
                      {lead.company_name && <span style={{ fontSize: '11px', color: '#9CA3AF' }}>· {lead.company_name}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${temp.bg} ${temp.text}`}>
                        {temp.emoji} {temp.label}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>
                        {status.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                      <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}</span>
                      {isOverdue && daysOverdue > 0 && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#EF4444' }}>⚠ {daysOverdue} ימים ללא טיפול</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0FDF4', textDecoration: 'none' }}>
                        <Phone size={12} style={{ color: '#15803D' }} />
                      </a>
                    )}
                    {lead.phone && (
                      <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`} target="_blank"
                        style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0FDF4', textDecoration: 'none' }}>
                        <MessageCircle size={12} style={{ color: '#15803D' }} />
                      </a>
                    )}
                    <Link href={`/leads/${lead.id}`} style={{ width: '28px', height: '28px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F3F4F6', textDecoration: 'none' }}>
                      <ChevronLeft size={12} style={{ color: '#6B7280' }} />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Team */}
          <div className="card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '14px' }}>
              <Users size={13} style={{ color: '#3730A3' }} />
              <h3 style={{ fontWeight: 800, color: '#111827', fontSize: '13px' }}>הצוות</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {bySalesperson.map(({ name, initials, hot, active, published }) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#14B8A6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 800, flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 800, color: '#111827', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                    <p style={{ fontSize: '11px', color: '#3730A3', fontWeight: 700, marginBottom: '2px' }}>נציג מכירות</p>
                    <div style={{ display: 'flex', gap: '7px' }}>
                      <span style={{ fontSize: '10px', color: '#6B7280' }}>{active} פעילים</span>
                      {hot > 0 && <span style={{ fontSize: '10px', color: '#EF4444', fontWeight: 700 }}>🔴 {hot}</span>}
                      {published > 0 && <span style={{ fontSize: '10px', color: '#15803D', fontWeight: 700 }}>✅ {published}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Infographic row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Donut - by status */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontWeight: 800, color: '#111827', fontSize: '13px', marginBottom: '16px' }}>פילוח לפי סטטוס</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={statusData} size={130} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {statusData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: '#6B7280', flex: 1 }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut - by source */}
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ fontWeight: 800, color: '#111827', fontSize: '13px', marginBottom: '16px' }}>פילוח לפי מקור</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart slices={sourceData} size={130} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sourceData.filter(d => d.value > 0).map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: '#6B7280', flex: 1 }}>{label}</span>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
