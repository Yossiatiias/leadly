'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { STATUS_CONFIG, SOURCE_LABELS, type Lead } from '@/types'
import LeadForm from '@/components/LeadForm'
import DeleteLeadButton from '@/components/DeleteLeadButton'
import InteractionModal from '@/components/InteractionModal'
import {
  ArrowRight, Phone, MessageCircle, Clock, Sparkles, Loader2,
  CheckCircle2, XCircle, RefreshCw, PhoneOff, PartyPopper,
  FileText, Flame, Building2, Percent, ChevronDown, ChevronUp
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'

function formatPhone(phone: string): string {
  if (!phone) return '—'
  const clean = phone.replace(/\D/g, '')
  if (clean.startsWith('972') && clean.length >= 12) {
    const local = '0' + clean.slice(3)
    return local.slice(0, 3) + '-' + local.slice(3, 6) + '-' + local.slice(6)
  }
  if (clean.startsWith('0') && clean.length === 10) {
    return clean.slice(0, 3) + '-' + clean.slice(3, 6) + '-' + clean.slice(6)
  }
  return phone
}

const OUTCOME_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  interested:    { icon: CheckCircle2, color: 'text-emerald-500', label: 'מעוניין' },
  not_interested:{ icon: XCircle,      color: 'text-red-400',     label: 'לא מעוניין' },
  follow_up:     { icon: RefreshCw,    color: 'text-blue-500',    label: 'לחזור' },
  no_answer:     { icon: PhoneOff,     color: 'text-gray-400',    label: 'לא ענה' },
  published:     { icon: PartyPopper,  color: 'text-green-500',   label: 'פרסם!' },
}

const TYPE_CONFIG: Record<string, { label: string; bg: string }> = {
  call:     { label: 'שיחה',            bg: 'bg-green-100' },
  whatsapp: { label: 'וואטסאפ',         bg: 'bg-emerald-100' },
  note:     { label: 'הערה',            bg: 'bg-blue-100' },
  status_change: { label: 'שינוי סטטוס', bg: 'bg-purple-100' },
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [lead, setLead] = useState<Lead | null>(null)
  const [profiles, setProfiles] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showForm, setShowForm] = useState(true)

  // AI state
  const [aiScript, setAiScript] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)

  const load = useCallback(async () => {
    const [{ data: leadData }, { data: profilesData }, { data: activitiesData }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id).single(),
      supabase.from('profiles').select('*'),
      supabase.from('lead_activities').select('*, profile:profiles(full_name)').eq('lead_id', id).order('created_at', { ascending: false }),
    ])
    setLead(leadData)
    setProfiles(profilesData || [])
    setActivities(activitiesData || [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function generateScript() {
    if (!lead) return
    setAiLoading(true)
    setScriptOpen(true)
    try {
      const lastActivity = activities[0]
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'script',
          data: {
            name: lead.name,
            company_name: lead.company_name,
            clinic_count: lead.clinic_count,
            source: lead.source,
            status: lead.status,
            notes: lead.notes,
            history: lastActivity?.details || lastActivity?.action || '',
            outcome: lastActivity?.outcome || '',
          },
        }),
      })
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const json = await res.json()
      setAiScript(json.text || 'לא התקבלה תשובה מה-AI')
    } catch (err) {
      setAiScript('שגיאה בחיבור ל-AI. בדוק שמפתח ה-Gemini תקין ב-.env.local')
      console.error('AI script error:', err)
    } finally {
      setAiLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-8 h-8 rounded-full sesya-gradient mx-auto mb-3 animate-pulse" />
        <p className="text-gray-400 text-sm">טוען...</p>
      </div>
    </div>
  )

  if (!lead) return <div className="p-6 text-gray-400">ליד לא נמצא</div>

  const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
  const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date() && !['published', 'not_relevant'].includes(lead.status)
  const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-5">
        <Link href="/leads" className="hover:text-[#5a9030] flex items-center gap-1 transition-colors">
          <ArrowRight size={14} />
          לידים
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-semibold">{lead.name}</span>
      </div>

      {/* Hero card */}
      <div className="card p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-extrabold shrink-0 bg-gray-100 text-gray-600">
              {lead.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-normal text-gray-900">{lead.name}</h1>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-gray-400">
                {lead.company_name && (
                  <span className="flex items-center gap-1">
                    <Building2 size={12} />
                    {lead.company_name}
                    {lead.clinic_count && ` · ${lead.clinic_count} קליניקות`}
                  </span>
                )}
                {lead.phone && (
                  <span dir="ltr" style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.02em' }}>{formatPhone(lead.phone)}</span>
                )}
                <span>{SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}</span>
                {lead.discount_percent && (
                  <span className="flex items-center gap-1 text-amber-600 font-semibold">
                    <Percent size={12} />
                    הנחה {lead.discount_percent}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            {lead.phone && (
              <a href={`tel:${lead.phone}`}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 font-bold text-sm transition-colors">
                <Phone size={14} />
                התקשר
              </a>
            )}
            {lead.phone && (
              <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm transition-colors">
                <MessageCircle size={14} />
                וואטסאפ
              </a>
            )}
            <button onClick={() => setShowModal(true)}
              className="btn-primary flex items-center gap-2 text-sm">
              <FileText size={14} />
              תעד אינטראקציה
            </button>
            <DeleteLeadButton leadId={lead.id} />
          </div>
        </div>

        {/* Overdue warning */}
        {isOverdue && daysOverdue > 0 && (
          <div className="mt-4 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-red-600 text-sm font-semibold">
            <Clock size={14} />
            ⚠ {daysOverdue} ימים ללא טיפול! follow-up היה אמור להיות ב-{new Date(lead.next_followup!).toLocaleDateString('he-IL')}
          </div>
        )}

        {/* Next follow-up (not overdue) */}
        {lead.next_followup && !isOverdue && !['published', 'not_relevant'].includes(lead.status) && (
          <div className="mt-4 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-blue-600 text-sm font-semibold">
            <Clock size={14} />
            follow-up הבא: {new Date(lead.next_followup).toLocaleDateString('he-IL')}
          </div>
        )}
      </div>

      {/* AI Call Script */}
      <div className="card mb-5 overflow-hidden">
        <button
          onClick={scriptOpen ? () => setScriptOpen(false) : generateScript}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center">
              <Sparkles size={15} className="text-purple-600" />
            </div>
            <div className="text-right">
              <p className="font-bold text-gray-800 text-sm">סקריפט שיחה מותאם אישית</p>
              <p className="text-xs text-gray-400">AI יכתוב לך איך לפתוח את השיחה</p>
            </div>
          </div>
          {aiLoading ? <Loader2 size={16} className="text-purple-500 animate-spin" /> :
           scriptOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>
        {scriptOpen && (
          <div className="px-6 pb-6 animate-slide-up">
            {aiLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                <Loader2 size={14} className="animate-spin" />
                מכין סקריפט מותאם...
              </div>
            ) : (
              <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(125,194,66,0.06), rgba(91,184,228,0.06))', border: '1.5px solid rgba(125,194,66,0.2)' }}>
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed" style={{ color: 'var(--fg-2)' }}>{aiScript}</pre>
                <button onClick={generateScript} className="mt-3 text-xs text-purple-500 hover:text-purple-700 font-semibold flex items-center gap-1">
                  <RefreshCw size={11} />
                  רענן סקריפט
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Edit form */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">פרטי הליד</h2>
            <button onClick={() => setShowForm(!showForm)} className="text-xs text-[#7DC242] font-bold hover:underline">
              {showForm ? 'סגור' : 'ערוך'}
            </button>
          </div>
          {showForm ? (
            <LeadForm profiles={profiles} lead={lead} />
          ) : (
            /* Read-only lead summary */
            <div className="card p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'שם מלא', value: lead.name },
                  { label: 'טלפון', value: formatPhone(lead.phone || ''), dir: 'ltr' },
                  { label: 'אימייל', value: lead.email, dir: 'ltr' },
                  { label: 'מקור', value: SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS] },
                  { label: 'שם מתחם', value: lead.company_name },
                  { label: 'קליניקות', value: lead.clinic_count?.toString() },
                  { label: 'הנחה שהוצעה', value: lead.discount_percent ? `${lead.discount_percent}%` : null },
                  { label: 'איש מכירות', value: (lead as any).profile?.full_name },
                ].map(({ label, value, dir }) => value ? (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>{label}</p>
                    <p className="text-sm font-medium text-gray-700" dir={dir as any}>{value}</p>
                  </div>
                ) : null)}
              </div>
              {lead.notes && (
                <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <p className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--fg-3)', fontWeight: 500 }}>מידע כללי רלוונטי</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-2)' }}>{lead.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-gray-400" />
              <h2 className="font-bold text-gray-800 text-sm">תיעוד שיחות עם הלקוח</h2>
            </div>
            <span className="text-xs text-gray-400 font-semibold">{activities.length}</span>
          </div>

          <div className="p-4">
            {!activities.length ? (
              <div className="text-center py-8">
                <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-2">
                  <Clock size={18} className="text-gray-300" />
                </div>
                <p className="text-gray-400 text-sm font-semibold">אין שיחות מתועדות עדיין</p>
                <button onClick={() => setShowModal(true)} className="mt-2 text-xs text-[#7DC242] font-bold hover:underline">
                  + תעד ראשון
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {activities.map((a, i) => {
                  const typeConf = TYPE_CONFIG[a.type] || TYPE_CONFIG.note
                  const outcomeConf = a.outcome ? OUTCOME_CONFIG[a.outcome] : null
                  const OutcomeIcon = outcomeConf?.icon

                  return (
                    <div key={a.id} className="relative">
                      {/* Timeline line */}
                      {i < activities.length - 1 && (
                        <div className="absolute right-[18px] top-8 bottom-0 w-px" style={{ background: 'var(--border-subtle)' }} />
                      )}
                      <div className="flex gap-3 pb-4">
                        {/* Icon */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeConf.bg}`}>
                          {a.type === 'call' && <Phone size={14} className="text-green-600" />}
                          {a.type === 'whatsapp' && <MessageCircle size={14} className="text-emerald-600" />}
                          {a.type === 'note' && <FileText size={14} className="text-blue-600" />}
                          {a.type === 'status_change' && <RefreshCw size={14} className="text-purple-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-bold text-gray-700">{a.action}</p>
                            {outcomeConf && OutcomeIcon && (
                              <span className={`flex items-center gap-0.5 text-[10px] font-bold ${outcomeConf.color}`}>
                                <OutcomeIcon size={10} />
                                {outcomeConf.label}
                              </span>
                            )}
                          </div>
                          {a.details && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.details}</p>}
                          <p className="text-[10px] text-gray-300 mt-1">
                            {a.profile?.full_name && `${a.profile.full_name} · `}
                            {formatDistanceToNow(new Date(a.created_at), { addSuffix: true, locale: he })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interaction modal */}
      {showModal && lead && (
        <InteractionModal
          leadId={lead.id}
          leadName={lead.name}
          leadNotes={lead.notes}
          onClose={() => setShowModal(false)}
          onSaved={() => { load(); setShowModal(false) }}
        />
      )}
    </div>
  )
}
