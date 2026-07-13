'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { STATUS_CONFIG, SOURCE_LABELS, getDisplayName, getLeadNumber, type Lead } from '@/types'
import LeadForm from '@/components/LeadForm'
import DeleteLeadButton from '@/components/DeleteLeadButton'
import InteractionModal from '@/components/InteractionModal'
import {
  ArrowRight, Phone, MessageCircle, Clock,
  CheckCircle2, XCircle, RefreshCw, PhoneOff, PartyPopper,
  FileText, MessageSquare,
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
  if (clean.startsWith('0') && clean.length === 10)
    return clean.slice(0, 3) + '-' + clean.slice(3, 6) + '-' + clean.slice(6)
  return phone
}

const OUTCOME_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  interested:     { icon: CheckCircle2, color: 'text-emerald-500', label: 'מעוניין' },
  not_interested: { icon: XCircle,      color: 'text-red-400',     label: 'לא מעוניין' },
  follow_up:      { icon: RefreshCw,    color: 'text-blue-500',    label: 'לחזור' },
  no_answer:      { icon: PhoneOff,     color: 'text-gray-400',    label: 'לא ענה' },
  published:      { icon: PartyPopper,  color: 'text-green-500',   label: 'פרסם!' },
}

const TYPE_CONFIG: Record<string, { label: string; bg: string }> = {
  call:          { label: 'שיחה',            bg: 'bg-green-100' },
  whatsapp:      { label: 'וואטסאפ',         bg: 'bg-emerald-100' },
  note:          { label: 'הערה',            bg: 'bg-blue-100' },
  status_change: { label: 'שינוי סטטוס',     bg: 'bg-purple-100' },
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [lead, setLead] = useState<Lead | null>(null)
  const [profiles, setProfiles] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [hasConversation, setHasConversation] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showForm, setShowForm] = useState(true)

  const load = useCallback(async () => {
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', (await supabase.auth.getUser()).data.user?.id || '').single()
    const bId = profile?.business_id || null
    setBusinessId(bId)

    const [{ data: leadData }, { data: profilesData }, { data: activitiesData }, { count: convCount }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id).single(),
      supabase.from('profiles').select('*'),
      supabase.from('lead_activities').select('*, profile:profiles(full_name)').eq('lead_id', id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('lead_id', id),
    ])
    setLead(leadData)
    setProfiles(profilesData || [])
    setActivities(activitiesData || [])
    setHasConversation((convCount || 0) > 0)
    setLoading(false)

    // Mark as opened if first time
    if (leadData && !leadData.first_opened_at) {
      await supabase.from('leads').update({ first_opened_at: new Date().toISOString() }).eq('id', id)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--brand)', opacity: 0.3, margin: '0 auto 10px', animation: 'pulse-soft 1.5s infinite' }} />
        <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען...</p>
      </div>
    </div>
  )

  if (!lead) return <div style={{ padding: '24px', color: 'var(--fg-4)' }}>ליד לא נמצא</div>

  const status = STATUS_CONFIG[lead.status]
  const displayName = getDisplayName(lead)
  const leadNum = getLeadNumber(lead)
  const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date() && !['published', 'not_relevant'].includes(lead.status)
  const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(lead.next_followup!).getTime()) / 86400000) : 0
  const waPhone = lead.phone ? '972' + lead.phone.replace(/^0/, '').replace(/-/g, '') : null
  const convHref = hasConversation ? `/conversations?lead_id=${lead.id}` : `/conversations?phone=${lead.phone}&new=1`

  return (
    <div style={{ padding: '28px', maxWidth: '1140px', margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fg-4)', marginBottom: '20px' }}>
        <Link href="/leads" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--fg-3)', textDecoration: 'none', fontWeight: 500 }}>
          <ArrowRight size={14} />
          לידים
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{displayName}</span>
        <span style={{ color: 'var(--fg-4)', fontSize: '11px', marginRight: '4px' }}>#{leadNum}</span>
      </div>

      {/* Hero card */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px', flexShrink: 0,
              background: 'var(--brand-soft)', color: 'var(--brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', fontWeight: 700,
            }}>
              {displayName.charAt(0)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--fg-1)' }}>{displayName}</h1>
                <span className={`${status.bg} ${status.text}`} style={{ fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '20px' }}>{status.label}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '5px', fontSize: '12px', color: 'var(--fg-3)' }}>
                {lead.phone && <span dir="ltr">{formatPhone(lead.phone)}</span>}
                <span>{SOURCE_LABELS[lead.source]}</span>
                {lead.email && <span dir="ltr">{lead.email}</span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            {waPhone && (
              <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: 'var(--radius-md)', background: '#EBFBF4', color: '#0F9E7B', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
                <MessageCircle size={13} />
                וואטסאפ
              </a>
            )}
            <Link href={convHref} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: 'var(--radius-md)', background: hasConversation ? 'var(--brand-soft)' : 'var(--bg-sunken)', color: hasConversation ? 'var(--brand)' : 'var(--fg-3)', border: hasConversation ? 'none' : '1.5px solid var(--border-default)', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
              <MessageSquare size={13} />
              {hasConversation ? 'עבור לשיחה' : 'התחל שיחה'}
            </Link>
            <button onClick={() => setShowModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              <FileText size={13} />
              תעד אינטראקציה
            </button>
            <DeleteLeadButton leadId={lead.id} />
          </div>
        </div>

        {isOverdue && daysOverdue > 0 && (
          <div style={{ marginTop: '12px', background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontSize: '13px', fontWeight: 600 }}>
            <Clock size={13} />
            {daysOverdue} ימים ללא טיפול — follow-up היה אמור ב-{new Date(lead.next_followup!).toLocaleDateString('he-IL')}
          </div>
        )}
        {lead.next_followup && !isOverdue && !['published', 'not_relevant'].includes(lead.status) && (
          <div style={{ marginTop: '12px', background: 'var(--brand-soft)', border: '1px solid var(--blue-100)', borderRadius: 'var(--radius-md)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand)', fontSize: '13px', fontWeight: 600 }}>
            <Clock size={13} />
            follow-up הבא: {new Date(lead.next_followup).toLocaleDateString('he-IL')}
          </div>
        )}
      </div>

      {/* AI Summary + Recommendation */}
      {(lead.ai_summary || lead.ai_recommendation) && (
        <div className="card" style={{ marginBottom: '16px', padding: '16px 20px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {lead.ai_summary && (
            <div style={{ flex: 1, minWidth: '200px' }}>
              <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>סיכום AI</p>
              <p style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.65 }}>{lead.ai_summary}</p>
            </div>
          )}
          {lead.ai_summary && lead.ai_recommendation && (
            <div style={{ width: '1px', background: 'var(--border-subtle)', alignSelf: 'stretch' }} />
          )}
          {lead.ai_recommendation && (
            <div style={{ flex: 1, minWidth: '200px' }}>
              <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>המלצת AI</p>
              <p style={{ fontSize: '13px', color: '#5B21B6', lineHeight: 1.65, fontWeight: 500 }}>{lead.ai_recommendation}</p>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        {/* Edit form */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h2 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '14px' }}>פרטי הליד</h2>
            <button onClick={() => setShowForm(!showForm)} style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {showForm ? 'סגור' : 'ערוך'}
            </button>
          </div>
          {showForm ? (
            <LeadForm profiles={profiles} lead={lead} businessId={businessId || undefined} />
          ) : (
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {[
                  { label: 'שם פרטי', value: lead.first_name },
                  { label: 'שם משפחה', value: lead.last_name },
                  { label: 'טלפון', value: formatPhone(lead.phone || ''), dir: 'ltr' },
                  { label: 'אימייל', value: lead.email, dir: 'ltr' },
                  { label: 'מקור', value: SOURCE_LABELS[lead.source] },
                  { label: 'נציג', value: (lead as any).profile?.full_name },
                ].map(({ label, value, dir }) => value ? (
                  <div key={label}>
                    <p style={{ fontSize: '10px', color: 'var(--fg-3)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '3px' }}>{label}</p>
                    <p style={{ fontSize: '13px', color: 'var(--fg-2)', fontWeight: 500 }} dir={dir as any}>{value}</p>
                  </div>
                ) : null)}
              </div>
              {lead.notes && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontSize: '10px', color: 'var(--fg-3)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '6px' }}>הערות</p>
                  <p style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.7 }}>{lead.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Clock size={13} style={{ color: 'var(--fg-4)' }} />
              <h2 style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px' }}>תיעוד שיחות</h2>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600 }}>{activities.length}</span>
          </div>

          <div style={{ padding: '12px 14px' }}>
            {!activities.length ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Clock size={24} style={{ color: 'var(--fg-4)', margin: '0 auto 8px', display: 'block' }} />
                <p style={{ color: 'var(--fg-3)', fontSize: '13px', fontWeight: 500 }}>אין תיעוד עדיין</p>
                <button onClick={() => setShowModal(true)} style={{ marginTop: '6px', fontSize: '12px', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  + תעד ראשון
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {activities.map((a, i) => {
                  const typeConf = TYPE_CONFIG[a.type] || TYPE_CONFIG.note
                  const outcomeConf = a.outcome ? OUTCOME_CONFIG[a.outcome] : null
                  const OutcomeIcon = outcomeConf?.icon

                  return (
                    <div key={a.id} style={{ position: 'relative' }}>
                      {i < activities.length - 1 && (
                        <div style={{ position: 'absolute', right: '17px', top: '36px', bottom: 0, width: '1px', background: 'var(--border-subtle)' }} />
                      )}
                      <div style={{ display: 'flex', gap: '10px', paddingBottom: '14px' }}>
                        <div className={`${typeConf.bg}`} style={{ width: '34px', height: '34px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {a.type === 'call' && <Phone size={13} className="text-green-600" />}
                          {a.type === 'whatsapp' && <MessageCircle size={13} className="text-emerald-600" />}
                          {a.type === 'note' && <FileText size={13} className="text-blue-600" />}
                          {a.type === 'status_change' && <RefreshCw size={13} className="text-purple-600" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-1)' }}>{a.action}</p>
                            {outcomeConf && OutcomeIcon && (
                              <span className={outcomeConf.color} style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '10px', fontWeight: 700 }}>
                                <OutcomeIcon size={10} />
                                {outcomeConf.label}
                              </span>
                            )}
                          </div>
                          {a.details && <p style={{ fontSize: '11px', color: 'var(--fg-3)', marginTop: '2px', lineHeight: 1.5 }}>{a.details}</p>}
                          <p style={{ fontSize: '10px', color: 'var(--fg-4)', marginTop: '3px' }}>
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

      {showModal && lead && (
        <InteractionModal
          leadId={lead.id}
          leadName={displayName}
          leadNotes={lead.notes}
          onClose={() => setShowModal(false)}
          onSaved={() => { load(); setShowModal(false) }}
        />
      )}
    </div>
  )
}
