'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STATUS_LABELS, SOURCE_LABELS, TEMP_CONFIG, STATUS_CONFIG } from '@/types'
import { Download, FileSpreadsheet, FileText, TrendingUp, Users, Flame, CheckCircle2 } from 'lucide-react'
import * as XLSX from 'xlsx'

export default function ReportsPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ status: '', source: '', temperature: '', from: '', to: '' })

  useEffect(() => {
    async function load() {
      setLoading(true)
      let query = supabase
        .from('leads')
        .select('*, profile:profiles!leads_assigned_to_fkey(full_name)')
        .order('created_at', { ascending: false })

      if (filters.status) query = query.eq('status', filters.status)
      if (filters.source) query = query.eq('source', filters.source)
      if (filters.temperature) query = query.eq('temperature', filters.temperature)
      if (filters.from) query = query.gte('created_at', filters.from)
      if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')

      const { data } = await query
      setLeads(data || [])
      setLoading(false)
    }
    load()
  }, [filters])

  function buildRows() {
    return leads.map(l => ({
      'שם': l.name,
      'טלפון': l.phone || '',
      'אימייל': l.email || '',
      'חברה / מתחם': l.company_name || '',
      'קליניקות': l.clinic_count || '',
      'הנחה שהוצעה': l.discount_percent ? `${l.discount_percent}%` : '',
      'טמפרטורה': l.temperature === 'hot' ? 'חם' : l.temperature === 'cold' ? 'קר' : 'בינוני',
      'מקור': SOURCE_LABELS[l.source as keyof typeof SOURCE_LABELS],
      'סטטוס': STATUS_LABELS[l.status as keyof typeof STATUS_LABELS],
      'איש מכירות': l.profile?.full_name || '',
      'הערות': l.notes || '',
      'follow-up': l.next_followup ? new Date(l.next_followup).toLocaleDateString('he-IL') : '',
      'תאריך יצירה': new Date(l.created_at).toLocaleDateString('he-IL'),
    }))
  }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(buildRows())
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'לידים')
    XLSX.writeFile(wb, `sesya-leads-${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  function exportCSV() {
    const rows = buildRows()
    if (!rows.length) return
    const header = Object.keys(rows[0])
    const csv = [header, ...rows.map(r => Object.values(r))].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sesya-leads-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const hasFilters = Object.values(filters).some(Boolean)

  // Stats from filtered leads
  const hot = leads.filter(l => l.temperature === 'hot').length
  const published = leads.filter(l => l.status === 'published').length
  const active = leads.filter(l => !['published', 'not_relevant'].includes(l.status)).length
  const convRate = leads.length ? Math.round((published / leads.length) * 100) : 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-800">דוחות וייצוא</h1>
          <p className="text-gray-400 text-sm mt-0.5">{leads.length} לידים{hasFilters && ' (מסוננים)'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="btn-ghost flex items-center gap-2 text-sm">
            <FileText size={14} />
            CSV
          </button>
          <button onClick={exportExcel} className="btn-primary flex items-center gap-2 text-sm">
            <FileSpreadsheet size={14} />
            Excel
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          { label: 'סה"כ לידים', value: leads.length, icon: Users, color: 'text-[#7DC242]', bg: 'bg-green-50' },
          { label: 'פעילים', value: active, icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
          { label: 'חמים', value: hot, icon: Flame, color: 'text-red-500', bg: 'bg-red-50' },
          { label: 'פרסמו', value: published, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 font-semibold">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">סטטוס</label>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="input-base" style={{ width: 'auto', minWidth: '120px' }}>
            <option value="">הכל</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">טמפרטורה</label>
          <select value={filters.temperature} onChange={e => setFilters(f => ({ ...f, temperature: e.target.value }))} className="input-base" style={{ width: 'auto', minWidth: '120px' }}>
            <option value="">הכל</option>
            <option value="hot">🔴 חם</option>
            <option value="medium">🟡 בינוני</option>
            <option value="cold">🔵 קר</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">מקור</label>
          <select value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))} className="input-base" style={{ width: 'auto', minWidth: '120px' }}>
            <option value="">הכל</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">מתאריך</label>
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="input-base" style={{ width: 'auto' }} dir="ltr" />
        </div>
        <div>
          <label className="block text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-1.5">עד תאריך</label>
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="input-base" style={{ width: 'auto' }} dir="ltr" />
        </div>
        {hasFilters && (
          <button onClick={() => setFilters({ status: '', source: '', temperature: '', from: '', to: '' })}
            className="text-xs text-gray-400 hover:text-red-500 font-semibold transition-colors pb-0.5">
            נקה הכל
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#1e1c38' }}>
              {['שם', 'חברה', 'טלפון', 'מקור', 'טמפ׳', 'סטטוס', 'איש מכירות', 'תאריך יצירה'].map((h, i) => (
                <th key={h} className="text-right text-[11px] font-extrabold text-gray-400 uppercase tracking-wider py-3 whitespace-nowrap"
                  style={{ paddingRight: '20px', paddingLeft: i === 0 ? '40px' : '20px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                <div className="w-6 h-6 rounded-full sesya-gradient mx-auto mb-2 animate-pulse" />
                טוען...
              </td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                אין תוצאות עם הסינון הנוכחי
              </td></tr>
            )}
            {leads.map(lead => {
              const temp = TEMP_CONFIG[lead.temperature as keyof typeof TEMP_CONFIG] || TEMP_CONFIG.medium
              const status = STATUS_CONFIG[lead.status as keyof typeof STATUS_CONFIG]
              return (
                <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 text-sm font-bold text-white whitespace-nowrap" style={{ paddingRight: '20px', paddingLeft: '40px' }}>{lead.name}</td>
                  <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {lead.company_name || '—'}
                    {lead.clinic_count && <span className="text-xs opacity-60"> · {lead.clinic_count}</span>}
                  </td>
                  <td className="px-5 py-3 text-sm font-mono whitespace-nowrap text-center" dir="ltr" style={{ color: 'rgba(255,255,255,0.5)', minWidth: '140px' }}>{lead.phone || '—'}</td>
                  <td className="px-8 py-3 whitespace-nowrap">
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>
                      {SOURCE_LABELS[lead.source as keyof typeof SOURCE_LABELS]}
                    </span>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${temp.bg} ${temp.text}`}>
                      {temp.emoji} {temp.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full status-${lead.status}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.5)' }}>{lead.profile?.full_name || '—'}</td>
                  <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.35)' }}>{new Date(lead.created_at).toLocaleDateString('he-IL')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {leads.length > 0 && (
        <p className="text-center text-xs text-gray-300 mt-4">
          אחוז המרה: {convRate}% ({published} מתוך {leads.length} לידים פרסמו)
        </p>
      )}
    </div>
  )
}
