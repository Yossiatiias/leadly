import { createClient } from '@/lib/supabase/server'
import { getPriorityScore, TEMP_CONFIG, STATUS_CONFIG, SOURCE_LABELS } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, Flame, Clock, TrendingUp, CheckCircle2, Users } from 'lucide-react'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  return 'ערב טוב'
}

function DonutChart({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: '96px', height: '96px' }}>
      <svg width="96" height="96" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="#E2E8F0" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, color: '#1E293B', lineHeight: 1 }}>{pct}%</span>
      </div>
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '12px', fontWeight: 800, color: '#1E293B' }}>{value}</span>
      </div>
      <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '99px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '99px', transition: 'width 0.6s ease' }} />
      </div>
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
    .slice(0, 10)

  const hot = active.filter(l => l.temperature === 'hot').length
  const overdueCount = active.filter(l => l.next_followup && new Date(l.next_followup) < new Date()).length
  const newToday = leads.filter(l => new Date(l.created_at) >= today).length
  const published = leads.filter(l => l.status === 'published').length
  const convRate = leads.length ? Math.round((published / leads.length) * 100) : 0

  const byStatus = [
    { label: 'חדש', value: leads.filter(l => l.status === 'new').length, color: '#3B82F6' },
    { label: 'ביצירת קשר', value: leads.filter(l => l.status === 'contacted').length, color: '#F59E0B' },
    { label: 'בתהליך', value: leads.filter(l => l.status === 'in_progress').length, color: '#0D9488' },
    { label: 'פורסם', value: leads.filter(l => l.status === 'published').length, color: '#16A34A' },
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
    <div style={{ padding: '28px 32px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ paddingRight: '8px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', marginBottom: '3px' }}>{getGreeting()}, {profile?.full_name?.split(' ')[0]} 👋</p>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1E293B' }}>תתחיל מכאן</h1>
        </div>
        <div style={{ textAlign: 'left', paddingLeft: '8px' }}>
          <p style={{ fontWeight: 700, color: '#1E293B', fontSize: '15px' }}>{dateStr}</p>
          <p style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
            {active.length === 0 ? '✅ כל הלידים מטופלים' : `${active.length} לידים פעילים`}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'לידים פעילים', value: active.length, icon: TrendingUp, color: '#256D85', bg: '#EFF6FF' },
          { label: 'לידים חמים',   value: hot,           icon: Flame,      color: '#DC2626', bg: '#FEF2F2' },
          { label: 'דורשים טיפול', value: overdueCount,  icon: Clock,      color: '#D97706', bg: '#FFFBEB' },
          { label: 'פרסמו',        value: published,     icon: CheckCircle2, color: '#16A34A', bg: '#F0FDF4' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <p style={{ fontSize: '28px', fontWeight: 800, color, lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: '12px', color: '#64748B', fontWeight: 600, marginTop: '3px' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {newToday > 0 && (
        <div style={{ borderRadius: '12px', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <span style={{ fontSize: '16px' }}>✨</span>
          <p style={{ color: '#1D4ED8', fontWeight: 600, fontSize: '14px' }}>{newToday} לידים חדשים הגיעו היום</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
        {/* Priority queue */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9' }}>
            <div>
              <h2 style={{ fontWeight: 800, color: '#1E293B', fontSize: '15px' }}>סדר עדיפויות</h2>
              <p style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>מדורגים לפי דחיפות אוטומטית</p>
            </div>
            <Link href="/leads" style={{ fontSize: '12px', fontWeight: 700, color: '#256D85', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
              כל הלידים <ChevronLeft size={12} />
            </Link>
          </div>

          <div>
            {priorities.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center' }}>
                <CheckCircle2 size={36} style={{ color: '#CBD5E1', margin: '0 auto 12px' }} />
                <p style={{ color: '#94A3B8', fontWeight: 600 }}>אין לידים פעילים כרגע</p>
              </div>
            ) : priorities.map((lead, i) => {
              const temp = TEMP_CONFIG[lead.temperature as keyof typeof TEMP_CONFIG] || TEMP_CONFIG.medium
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date()
              const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0

              return (
                <div key={lead.id} style={{ padding: '14px 22px', borderBottom: i < priorities.length - 1 ? '1px solid #F8FAFC' : 'none', display: 'flex', alignItems: 'center', gap: '14px' }}
                  onMouseEnter={undefined}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 800,
                    background: i === 0 ? 'linear-gradient(135deg,#256D85,#2F9BC1)' : '#F1F5F9',
                    color: i === 0 ? 'white' : '#64748B',
                  }}>
                    {i + 1}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Link href={`/leads/${lead.id}`} style={{ fontWeight: 700, color: '#1E293B', textDecoration: 'none', fontSize: '14px' }}>
                        {lead.name}
                      </Link>
                      {lead.company_name && <span style={{ fontSize: '12px', color: '#94A3B8' }}>· {lead.company_name}</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${temp.bg} ${temp.text}`}>
                        {temp.emoji} {temp.label}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>
                        {status.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '3px' }}>
                      <span style={{ fontSize: '11px', color: '#94A3B8' }}>{SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}</span>
                      {isOverdue && daysOverdue > 0 && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626' }}>⚠ {daysOverdue} ימים ללא טיפול</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} style={{ width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0FDF4', textDecoration: 'none' }} title="התקשר">
                        <Phone size={13} style={{ color: '#16A34A' }} />
                      </a>
                    )}
                    {lead.phone && (
                      <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`} target="_blank"
                        style={{ width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F0FDF4', textDecoration: 'none' }} title="וואטסאפ">
                        <MessageCircle size={13} style={{ color: '#16A34A' }} />
                      </a>
                    )}
                    <Link href={`/leads/${lead.id}`} style={{ width: '30px', height: '30px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F5F9', textDecoration: 'none' }}>
                      <ChevronLeft size={13} style={{ color: '#64748B' }} />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingLeft: '12px' }}>
          {/* Team */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Users size={14} style={{ color: '#256D85' }} />
              <h3 style={{ fontWeight: 800, color: '#1E293B', fontSize: '14px' }}>הצוות</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {bySalesperson.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#94A3B8' }}>אין נציגים</p>
              ) : bySalesperson.map(({ name, initials, hot, active, published }) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: 'linear-gradient(135deg,#256D85,#2F9BC1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 800, flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, color: '#1E293B', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                      <span style={{ fontSize: '11px', color: '#64748B' }}>{active} פעילים</span>
                      {hot > 0 && <span style={{ fontSize: '11px', color: '#DC2626', fontWeight: 700 }}>🔴 {hot}</span>}
                      {published > 0 && <span style={{ fontSize: '11px', color: '#16A34A', fontWeight: 700 }}>✅ {published}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick stats */}
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ fontWeight: 800, color: '#1E293B', fontSize: '14px', marginBottom: '16px' }}>סיכום מהיר</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'לידים פעילים', value: active.length, color: '#256D85' },
                { label: 'לידים חמים', value: hot, color: '#DC2626' },
                { label: 'דורשים טיפול', value: overdueCount, color: '#D97706' },
                { label: 'פרסמו', value: published, color: '#16A34A' },
                { label: 'סה"כ לידים', value: leads.length, color: '#2F9BC1' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: '13px', color: '#64748B' }}>{label}</span>
                  <span style={{ fontSize: '20px', fontWeight: 800, color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Infographic row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Conversion donut */}
        <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '28px' }}>
          <DonutChart value={published} total={leads.length} color="#16A34A" />
          <div>
            <h3 style={{ fontWeight: 800, color: '#1E293B', fontSize: '15px', marginBottom: '6px' }}>אחוז המרה</h3>
            <p style={{ fontSize: '13px', color: '#64748B' }}>{published} מתוך {leads.length} לידים פרסמו</p>
            <p style={{ fontSize: '13px', color: '#64748B', marginTop: '8px' }}>
              <span style={{ fontWeight: 800, color: '#256D85', fontSize: '18px' }}>{convRate}%</span> הצלחה
            </p>
          </div>
        </div>

        {/* Status breakdown bars */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontWeight: 800, color: '#1E293B', fontSize: '15px', marginBottom: '18px' }}>פילוח לפי סטטוס</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {byStatus.map(({ label, value, color }) => (
              <BarRow key={label} label={label} value={value} max={leads.length || 1} color={color} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
