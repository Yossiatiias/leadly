import { createClient } from '@/lib/supabase/server'
import { getPriorityScore, TEMP_CONFIG, STATUS_CONFIG, SOURCE_LABELS } from '@/types'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronLeft, Flame, Clock, Star, TrendingUp, CheckCircle2, Users } from 'lucide-react'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  return 'ערב טוב'
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

  const bySalesperson = (profiles || []).map(p => ({
    name: p.full_name,
    initials: p.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?',
    hot: leads.filter(l => l.assigned_to === p.id && l.temperature === 'hot' && !['published', 'not_relevant'].includes(l.status)).length,
    active: leads.filter(l => l.assigned_to === p.id && !['published', 'not_relevant'].includes(l.status)).length,
    published: leads.filter(l => l.assigned_to === p.id && l.status === 'published').length,
  }))

  const dateStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-7">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div style={{ paddingRight: '8px' }}>
          <p className="text-sm font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{getGreeting()}, {profile?.full_name?.split(' ')[0]} 👋</p>
          <h1 className="text-3xl font-extrabold text-white">תתחיל מכאן</h1>
        </div>
        <div style={{ textAlign: 'left', paddingLeft: '8px' }}>
          <p className="text-white font-bold text-lg">{dateStr}</p>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {active.length === 0 ? '✅ כל הלידים מטופלים' : `${active.length} לידים פעילים`}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'לידים פעילים', value: active.length, icon: TrendingUp, color: '#a78bfa', bg: 'rgba(139,92,246,0.15)' },
          { label: 'לידים חמים',   value: hot,           icon: Flame,      color: '#fca5a5', bg: 'rgba(239,68,68,0.15)' },
          { label: 'ממתינים לטיפול', value: overdueCount, icon: Clock,    color: '#fcd34d', bg: 'rgba(245,158,11,0.15)' },
          { label: 'פרסמו',        value: published,     icon: CheckCircle2, color: '#6ee7b7', bg: 'rgba(16,185,129,0.15)' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: bg }}>
              <Icon size={22} style={{ color }} />
            </div>
            <div>
              <p className="text-3xl font-extrabold text-white">{value}</p>
              <p className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {newToday > 0 && (
        <div className="rounded-2xl px-5 py-3 flex items-center gap-3" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <Star size={16} className="text-purple-300 shrink-0" />
          <p className="text-purple-200 font-semibold text-sm">{newToday} לידים חדשים הגיעו היום</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Priority queue */}
        <div className="col-span-2 card overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <h2 className="font-extrabold text-white text-base">סדר עדיפויות</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>מדורגים לפי דחיפות אוטומטית</p>
            </div>
            <Link href="/leads" className="text-xs font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors">
              כל הלידים <ChevronLeft size={12} />
            </Link>
          </div>

          <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
            {priorities.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-3 text-purple-500/30" />
                <p className="font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>אין לידים פעילים כרגע</p>
              </div>
            ) : priorities.map((lead, i) => {
              const temp = TEMP_CONFIG[lead.temperature as keyof typeof TEMP_CONFIG] || TEMP_CONFIG.medium
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date()
              const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0

              return (
                <div key={lead.id} className="px-6 py-4 transition-colors group" style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                  onMouseEnter={undefined}>
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${i === 0 ? 'sesya-gradient text-white' : ''}`}
                      style={i !== 0 ? { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' } : undefined}>
                      {i + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/leads/${lead.id}`} className="font-bold text-white hover:text-purple-300 transition-colors">
                          {lead.name}
                        </Link>
                        {lead.company_name && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>· {lead.company_name}</span>}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${temp.bg} ${temp.text}`}>
                          {temp.emoji} {temp.label}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}</span>
                        {isOverdue && daysOverdue > 0 && (
                          <span className="text-xs font-bold text-red-400">⚠ {daysOverdue} ימים ללא טיפול</span>
                        )}
                        {lead.notes && <span className="text-xs truncate max-w-40" style={{ color: 'rgba(255,255,255,0.3)' }}>{lead.notes}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                          style={{ background: 'rgba(16,185,129,0.15)' }} title="התקשר">
                          <Phone size={13} className="text-emerald-400" />
                        </a>
                      )}
                      {lead.phone && (
                        <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`} target="_blank"
                          className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                          style={{ background: 'rgba(16,185,129,0.1)' }} title="וואטסאפ">
                          <MessageCircle size={13} className="text-emerald-300" />
                        </a>
                      )}
                      <Link href={`/leads/${lead.id}`} className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                        style={{ background: 'rgba(255,255,255,0.07)' }}>
                        <ChevronLeft size={13} style={{ color: 'rgba(255,255,255,0.5)' }} />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side panels */}
        <div className="space-y-5" style={{ paddingLeft: '12px' }}>
          {/* Team */}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-5">
              <Users size={15} className="text-purple-400" />
              <h3 className="font-extrabold text-white text-sm">הצוות</h3>
            </div>
            <div className="space-y-4">
              {bySalesperson.length === 0 ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>אין נציגים</p>
              ) : bySalesperson.map(({ name, initials, hot, active, published }) => (
                <div key={name} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl sesya-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm truncate">{name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{active} פעילים</span>
                      {hot > 0 && <span className="text-[11px] text-red-400 font-bold">🔴 {hot} חמים</span>}
                      {published > 0 && <span className="text-[11px] text-emerald-400 font-bold">✅ {published}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick stats */}
          <div className="card p-6">
            <h3 className="font-extrabold text-white text-sm mb-5">סיכום מהיר</h3>
            <div className="space-y-3">
              {[
                { label: 'לידים פעילים', value: active.length, color: 'text-purple-300' },
                { label: 'לידים חמים', value: hot, color: 'text-red-300' },
                { label: 'דורשים טיפול', value: overdueCount, color: 'text-amber-300' },
                { label: 'פרסמו', value: published, color: 'text-emerald-300' },
                { label: 'סה"כ לידים', value: leads.length, color: 'text-blue-300' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
                  <span className={`text-xl font-extrabold ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
