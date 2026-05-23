'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TEMP_CONFIG, STATUS_CONFIG, SOURCE_LABELS, STATUS_LABELS, getPriorityScore, type Lead } from '@/types'
import { Search, Phone, MessageCircle, SlidersHorizontal, X, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

const STATUSES = ['new', 'contacted', 'in_progress', 'published', 'not_relevant']
const SOURCES = ['backoffice', 'whatsapp', 'social', 'outreach', 'manual']
const TEMPS = ['hot', 'medium', 'cold']

export default function LeadsPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ status: '', source: '', temperature: '', assigned: '' })

  useEffect(() => {
    async function load() {
      const [{ data: leadsData }, { data: profilesData }] = await Promise.all([
        supabase.from('leads').select('*, profile:profiles!leads_assigned_to_fkey(full_name)').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*'),
      ])
      setLeads(leadsData || [])
      setProfiles(profilesData || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    return leads.filter(l => {
      const q = search.toLowerCase()
      const matchSearch = !q || l.name.toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.company_name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q)
      const matchStatus = !filters.status || l.status === filters.status
      const matchSource = !filters.source || l.source === filters.source
      const matchTemp = !filters.temperature || l.temperature === filters.temperature
      const matchAssigned = !filters.assigned || l.assigned_to === filters.assigned
      return matchSearch && matchStatus && matchSource && matchTemp && matchAssigned
    }).sort((a, b) => getPriorityScore(b) - getPriorityScore(a))
  }, [leads, search, filters])

  const hasFilters = Object.values(filters).some(Boolean)

  function clearFilters() { setFilters({ status: '', source: '', temperature: '', assigned: '' }) }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-8 h-8 rounded-full sesya-gradient mx-auto mb-3 animate-pulse" />
        <p className="text-gray-400 text-sm">טוען לידים...</p>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 500, color: 'var(--fg-2)' }}>כל הלידים</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {filtered.length} מתוך {leads.length} לידים
            {hasFilters && ' (מסונן)'}
          </p>
        </div>
        <Link href="/leads/new" className="btn-primary flex items-center gap-2 text-sm">
          + ליד חדש
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="card p-4 mb-4 flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון, חברה, אימייל..."
            className="input-base pr-10"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border-1.5 transition-all ${showFilters || hasFilters ? 'sesya-gradient text-white border-transparent' : 'btn-ghost'}`}
        >
          <SlidersHorizontal size={14} />
          סינון {hasFilters && `(${Object.values(filters).filter(Boolean).length})`}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-red-500 transition-colors font-semibold flex items-center gap-1">
            <X size={12} />
            נקה
          </button>
        )}
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="card p-4 mb-4 animate-slide-up grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">סטטוס</label>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="input-base">
              <option value="">הכל</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s as keyof typeof STATUS_LABELS]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">טמפרטורה</label>
            <select value={filters.temperature} onChange={e => setFilters(f => ({ ...f, temperature: e.target.value }))} className="input-base">
              <option value="">הכל</option>
              {TEMPS.map(t => <option key={t} value={t}>{TEMP_CONFIG[t as keyof typeof TEMP_CONFIG].emoji} {TEMP_CONFIG[t as keyof typeof TEMP_CONFIG].label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">מקור</label>
            <select value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))} className="input-base">
              <option value="">הכל</option>
              {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABELS[s as keyof typeof SOURCE_LABELS]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wide">איש מכירות</label>
            <select value={filters.assigned} onChange={e => setFilters(f => ({ ...f, assigned: e.target.value }))} className="input-base">
              <option value="">הכל</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-sunken)' }}>
              {['', 'איש קשר', 'טלפון', 'מקור', 'סטטוס', 'איש מכירות', 'follow-up', ''].map((h, i) => (
                <th key={i} style={{ textAlign: 'right', fontSize: '11px', fontWeight: 500, color: 'var(--fg-2)', padding: '10px 14px', letterSpacing: '0.03em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-16">
                <Search size={36} className="mx-auto text-gray-200 mb-3" />
                <p className="text-gray-400 font-semibold">לא נמצאו לידים</p>
                <p className="text-gray-300 text-sm mt-1">נסה לשנות את החיפוש או הסינון</p>
              </td></tr>
            )}
            {filtered.map(lead => {
              const temp = TEMP_CONFIG[lead.temperature as keyof typeof TEMP_CONFIG] || TEMP_CONFIG.medium
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              const isOverdue = lead.next_followup && new Date(lead.next_followup) < new Date() && !['published', 'not_relevant'].includes(lead.status)

              return (
                <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors group">
                  {/* Temp indicator */}
                  <td className="pr-4 pl-0 py-4 w-1">
                    <div className={`w-1.5 h-8 rounded-full mx-auto ${temp.dot}`} />
                  </td>
                  {/* Name */}
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-extrabold shrink-0 ${temp.bg} ${temp.text}`}>
                        {lead.name.charAt(0)}
                      </div>
                      <div>
                        <Link href={`/leads/${lead.id}`} className="font-bold text-gray-900 hover:text-[#5a9030] transition-colors text-sm block">
                          {lead.name}
                        </Link>
                        {lead.company_name && <p className="text-xs text-gray-400">{lead.company_name}{lead.clinic_count ? ` · ${lead.clinic_count} קליניקות` : ''}</p>}
                        {!lead.company_name && lead.email && <p className="text-xs text-gray-400">{lead.email}</p>}
                      </div>
                    </div>
                  </td>
                  {/* Phone */}
                  <td className="px-3 py-4 text-sm text-gray-500 font-mono text-center" dir="ltr">{lead.phone || '—'}</td>
                  {/* Source */}
                  <td className="px-3 py-4">
                    <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                      {SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}
                    </span>
                  </td>
                  {/* Status */}
                  <td className="px-3 py-4">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full status-${lead.status}`}>
                      {status.label}
                    </span>
                  </td>
                  {/* Salesperson */}
                  <td className="px-3 py-4 text-sm text-gray-500">{(lead as any).profile?.full_name || '—'}</td>
                  {/* Follow-up */}
                  <td className="px-3 py-4 text-sm">
                    {lead.next_followup ? (
                      <span className={`font-bold ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                        {isOverdue && '⚠ '}{new Date(lead.next_followup).toLocaleDateString('he-IL')}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="w-8 h-8 rounded-xl bg-green-50 hover:bg-green-100 flex items-center justify-center" title="התקשר">
                          <Phone size={13} className="text-green-600" />
                        </a>
                      )}
                      {lead.phone && (
                        <a href={`https://wa.me/972${lead.phone.replace(/^0/, '').replace(/-/g, '')}`} target="_blank" className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center" title="וואטסאפ">
                          <MessageCircle size={13} className="text-emerald-600" />
                        </a>
                      )}
                      <Link href={`/leads/${lead.id}`} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                        <ChevronLeft size={13} className="text-gray-500" />
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
