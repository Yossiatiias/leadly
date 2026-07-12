'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  STATUS_CONFIG, SOURCE_LABELS, STATUS_LABELS, TREATMENT_LABELS, TREATMENT_COLORS,
  isNewLead, getDisplayName, getLeadNumber,
  type Lead, type TreatmentType,
} from '@/types'
import { Search, Phone, MessageSquare, SlidersHorizontal, X, ChevronLeft, UserPlus } from 'lucide-react'
import Link from 'next/link'

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

const ALL_STATUSES = [
  'new', 'contacted', 'in_progress', 'published', 'not_relevant',
  'no_show', 'arrived', 'quote_sent', 'quote_followup', 'closed', 'lost',
]
const ALL_SOURCES = ['backoffice', 'whatsapp', 'social', 'outreach', 'manual', 'scrape', 'bot']
const ALL_TREATMENTS = ['implant', 'restorative', 'veneers', 'whitening', 'orthodontics', 'checkup', 'other']

export default function LeadsPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<any[]>([])
  const [conversationPhones, setConversationPhones] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ status: '', source: '', assigned: '', treatment_type: '' })

  useEffect(() => {
    async function load() {
      const [{ data: leadsData }, { data: profilesData }, { data: convsData }] = await Promise.all([
        supabase.from('leads')
          .select('*, profile:profiles!leads_assigned_to_fkey(full_name)')
          .order('created_at', { ascending: false }),
        supabase.from('profiles').select('*'),
        supabase.from('conversations').select('phone_number').not('phone_number', 'is', null),
      ])
      setLeads(leadsData || [])
      setProfiles(profilesData || [])
      setConversationPhones(new Set((convsData || []).map((c: any) => c.phone_number)))
      setLoading(false)
    }
    load()
  }, [])

  const markOpened = useCallback(async (leadId: string) => {
    await supabase.from('leads').update({ first_opened_at: new Date().toISOString() }).eq('id', leadId).is('first_opened_at', null)
    setLeads(prev => prev.map(l => l.id === leadId && !l.first_opened_at ? { ...l, first_opened_at: new Date().toISOString() } : l))
  }, [supabase])

  const filtered = useMemo(() => {
    return leads.filter(l => {
      const q = search.toLowerCase()
      const displayName = getDisplayName(l)
      const matchSearch = !q
        || displayName.toLowerCase().includes(q)
        || (l.phone || '').includes(q)
        || (l.email || '').toLowerCase().includes(q)
      const matchStatus = !filters.status || l.status === filters.status
      const matchSource = !filters.source || l.source === filters.source
      const matchAssigned = !filters.assigned || l.assigned_to === filters.assigned
      const matchTreatment = !filters.treatment_type || l.treatment_type === filters.treatment_type
      return matchSearch && matchStatus && matchSource && matchAssigned && matchTreatment
    })
  }, [leads, search, filters])

  const hasFilters = Object.values(filters).some(Boolean)
  function clearFilters() { setFilters({ status: '', source: '', assigned: '', treatment_type: '' }) }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '64px', padding: '80px 0' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--brand)', opacity: 0.3, margin: '0 auto 10px', animation: 'pulse-soft 1.5s infinite' }} />
        <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען לידים...</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--fg-1)', marginBottom: '3px' }}>לידים</h1>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)' }}>
            {filtered.length} מוצגים{leads.length !== filtered.length ? ` מתוך ${leads.length}` : ''}
          </p>
        </div>
        <Link href="/leads/new" style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'var(--brand)', color: 'white', fontWeight: 600,
          padding: '9px 16px', borderRadius: 'var(--radius-md)', textDecoration: 'none',
          fontSize: '13px', boxShadow: '0 1px 3px rgba(43,107,232,0.3)',
        }}>
          <UserPlus size={14} />
          ליד חדש
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-4)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון, אימייל..."
            className="input-base"
            style={{ paddingRight: '34px' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex' }}>
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
            background: showFilters || hasFilters ? 'var(--brand)' : 'var(--bg-sunken)',
            color: showFilters || hasFilters ? 'white' : 'var(--fg-2)',
            border: showFilters || hasFilters ? 'none' : '1.5px solid var(--border-default)',
          }}
        >
          <SlidersHorizontal size={13} />
          סינון {hasFilters && `(${Object.values(filters).filter(Boolean).length})`}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', fontSize: '12px', fontFamily: 'inherit' }}>
            <X size={11} /> נקה
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="card animate-slide-up" style={{ padding: '14px 16px', marginBottom: '12px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
          {[
            { key: 'status', label: 'סטטוס', opts: ALL_STATUSES, labels: STATUS_LABELS },
            { key: 'source', label: 'מקור', opts: ALL_SOURCES, labels: SOURCE_LABELS },
            { key: 'treatment_type', label: 'סוג טיפול', opts: ALL_TREATMENTS, labels: TREATMENT_LABELS },
          ].map(({ key, label, opts, labels }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--fg-3)', marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</label>
              <select value={(filters as any)[key]} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))} className="input-base" style={{ fontSize: '13px' }}>
                <option value="">הכל</option>
                {opts.map(s => <option key={s} value={s}>{(labels as any)[s]}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--fg-3)', marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>איש מכירות</label>
            <select value={filters.assigned} onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))} className="input-base" style={{ fontSize: '13px' }}>
              <option value="">הכל</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
              {[
                { label: '#',           w: '56px'  },
                { label: 'איש קשר',     w: 'auto'  },
                { label: 'טלפון',        w: '120px' },
                { label: 'טיפול',        w: '110px' },
                { label: 'מקור',         w: '100px' },
                { label: 'סטטוס',        w: '110px' },
                { label: 'נציג',         w: '90px'  },
                { label: '',             w: '80px'  },
              ].map((h, i) => (
                <th key={i} style={{ textAlign: 'right', fontSize: '10px', fontWeight: 600, color: 'var(--fg-3)', padding: '10px 14px', width: h.w, letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '60px 0' }}>
                <Search size={32} style={{ color: 'var(--fg-4)', margin: '0 auto 12px', display: 'block' }} />
                <p style={{ color: 'var(--fg-3)', fontWeight: 500, fontSize: '14px' }}>לא נמצאו לידים</p>
                <p style={{ color: 'var(--fg-4)', fontSize: '12px', marginTop: '4px' }}>שנה את החיפוש או הסינון</p>
              </td></tr>
            )}
            {filtered.map(lead => {
              const status = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new
              const isNew = isNewLead(lead)
              const displayName = getDisplayName(lead)
              const numStr = getLeadNumber(lead)
              const treatmentColor = lead.treatment_type ? TREATMENT_COLORS[lead.treatment_type as TreatmentType] : undefined
              const hasConversation = lead.phone ? conversationPhones.has(lead.phone) : false
              const waPhone = lead.phone ? '972' + lead.phone.replace(/^0/, '').replace(/-/g, '') : null

              return (
                <tr key={lead.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  className="group"
                >
                  {/* # */}
                  <td style={{ padding: '12px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {numStr}
                  </td>

                  {/* Name */}
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                          width: '34px', height: '34px', borderRadius: '10px',
                          background: 'var(--brand-soft)', color: 'var(--brand)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 600, fontSize: '13px',
                        }}>
                          {displayName.charAt(0)}
                        </div>
                        {isNew && (
                          <span style={{
                            position: 'absolute', top: '-5px', right: '-5px',
                            background: 'var(--brand)', color: 'white',
                            fontSize: '8px', fontWeight: 700, lineHeight: 1,
                            padding: '2px 5px', borderRadius: '4px',
                          }}>חדש</span>
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/leads/${lead.id}`}
                          onClick={() => markOpened(lead.id)}
                          style={{ fontWeight: 500, color: 'var(--fg-1)', textDecoration: 'none', fontSize: '13px', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {displayName}
                        </Link>
                        {lead.notes && (
                          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                            {lead.notes.slice(0, 70)}
                          </p>
                        )}
                        {!lead.notes && lead.email && (
                          <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '1px' }}>{lead.email}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Phone */}
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums', direction: 'ltr', textAlign: 'right' }}>
                    {formatPhone(lead.phone || '')}
                  </td>

                  {/* Treatment */}
                  <td style={{ padding: '12px 14px' }}>
                    {lead.treatment_type ? (
                      <span style={{
                        fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '6px',
                        background: treatmentColor ? `${treatmentColor}18` : 'var(--bg-hover)',
                        color: treatmentColor || 'var(--fg-3)',
                        border: `1px solid ${treatmentColor ? `${treatmentColor}30` : 'var(--border-subtle)'}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {TREATMENT_LABELS[lead.treatment_type as TreatmentType]}
                      </span>
                    ) : <span style={{ color: 'var(--fg-4)', fontSize: '12px' }}>—</span>}
                  </td>

                  {/* Source */}
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--fg-3)', background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', padding: '3px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </span>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '12px 14px' }}>
                    <span className={`${status.bg} ${status.text}`} style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '20px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {status.label}
                    </span>
                  </td>

                  {/* Assignee */}
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90px' }}>
                    {(lead as any).profile?.full_name || '—'}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} title="התקשר" style={{
                          width: '28px', height: '28px', borderRadius: '8px',
                          background: 'var(--success-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Phone size={12} style={{ color: 'var(--success)' }} />
                        </a>
                      )}
                      {waPhone && (
                        <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" title="וואטסאפ" style={{
                          width: '28px', height: '28px', borderRadius: '8px',
                          background: '#EBFBF4', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <MessageSquare size={12} style={{ color: '#0F9E7B' }} />
                        </a>
                      )}
                      <Link href={hasConversation ? `/conversations?phone=${lead.phone}` : `/conversations?phone=${lead.phone}&new=1`}
                        title={hasConversation ? 'עבור לשיחה' : 'התחל שיחה'}
                        style={{
                          width: '28px', height: '28px', borderRadius: '8px',
                          background: hasConversation ? 'var(--brand-soft)' : 'var(--bg-sunken)',
                          border: hasConversation ? 'none' : '1px solid var(--border-subtle)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                        <MessageSquare size={12} style={{ color: hasConversation ? 'var(--brand)' : 'var(--fg-4)' }} />
                      </Link>
                      <Link href={`/leads/${lead.id}`} onClick={() => markOpened(lead.id)} style={{
                        width: '28px', height: '28px', borderRadius: '8px',
                        background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ChevronLeft size={13} style={{ color: 'var(--fg-3)' }} />
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
