'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Check, X, Crosshair, Settings2, Play, ExternalLink, Clock, Trash2, MessageSquare } from 'lucide-react'

interface Candidate {
  id: string
  business_id: string
  source_url: string
  source_link: string | null
  source_name: string | null
  summary: string | null
  name: string | null
  phone: string | null
  email: string | null
  raw_text: string | null
  status: 'pending' | 'approved' | 'rejected'
  found_at: string
}

type SourceType = 'facebook' | 'website' | 'instagram' | 'other'

interface HuntSource {
  url: string
  label: string
  type: SourceType
}

interface HuntSchedule {
  enabled: boolean
  interval_hours: number
  scan_hour: number
  next_scan_at: string | null
  last_scan_at: string | null
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00`,
}))

const SOURCE_TYPES: { value: SourceType; label: string; emoji: string; placeholder: string }[] = [
  { value: 'facebook',  label: 'פייסבוק',   emoji: '👥', placeholder: 'https://facebook.com/groups/...' },
  { value: 'instagram', label: 'אינסטגרם',  emoji: '📷', placeholder: 'https://instagram.com/...' },
  { value: 'website',   label: 'אתר',       emoji: '🌐', placeholder: 'https://example.com' },
  { value: 'other',     label: 'אחר',       emoji: '📋', placeholder: 'URL או שם המאגר' },
]

function getTypeMeta(type: SourceType) {
  return SOURCE_TYPES.find(t => t.value === type) || SOURCE_TYPES[3]
}

export default function LeadHuntingPage() {
  const supabase = createClient()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sources, setSources] = useState<HuntSource[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<SourceType>('facebook')
  const [schedule, setSchedule] = useState<HuntSchedule>({ enabled: false, interval_hours: 24, scan_hour: 8, next_scan_at: null, last_scan_at: null })
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
      if (!profile?.business_id) return
      setBusinessId(profile.business_id)
      const { data: biz } = await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
      const raw: HuntSource[] = (biz?.settings?.hunt_sources || []).map((s: any) => ({
        url: s.url,
        label: s.label,
        type: s.type || 'facebook',
      }))
      setSources(raw)
      if (biz?.settings?.hunt_schedule) {
        const s = biz.settings.hunt_schedule
        setSchedule({ enabled: false, interval_hours: 24, scan_hour: 8, next_scan_at: null, last_scan_at: null, ...s })
      }
      await loadCandidates(profile.business_id)
    }
    load()
  }, [])

  async function loadCandidates(bId: string) {
    const { data } = await supabase
      .from('lead_candidates')
      .select('*')
      .eq('business_id', bId)
      .order('found_at', { ascending: false })
      .limit(100)
    setCandidates(data || [])
  }

  async function persistSettings(patch: object, msg: string) {
    if (!businessId) return
    setSaving(true)
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
    await supabase.from('businesses').update({ settings: { ...(biz?.settings || {}), ...patch } }).eq('id', businessId)
    setSaving(false)
    showToast(msg)
  }

  async function persistSources(updated: HuntSource[], msg: string) {
    await persistSettings({ hunt_sources: updated }, msg)
  }

  async function saveSchedule(updated: HuntSchedule) {
    let next: string | null = null
    if (updated.enabled) {
      const now = new Date()
      const candidate = new Date()
      candidate.setHours(updated.scan_hour, 0, 0, 0)
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
      next = candidate.toISOString()
    }
    const final = { ...updated, next_scan_at: next }
    setSchedule(final)
    await persistSettings({ hunt_schedule: final }, updated.enabled ? 'סריקה מתוזמנת הופעלה' : 'סריקה מתוזמנת הופסקה')
  }

  async function addSource() {
    if (!newUrl.trim()) return
    let label = newLabel.trim()
    if (!label) {
      try { label = new URL(newUrl.startsWith('http') ? newUrl : 'https://' + newUrl).hostname }
      catch { label = newUrl.trim() }
    }
    const updated: HuntSource[] = [...sources, { url: newUrl.trim(), label, type: newType }]
    setSources(updated)
    setNewUrl(''); setNewLabel('')
    await persistSources(updated, 'מקור נוסף ונשמר')
  }

  async function removeSource(i: number) {
    const updated = sources.filter((_, j) => j !== i)
    setSources(updated)
    await persistSources(updated, 'מקור הוסר')
  }

  async function scanAll() {
    if (!businessId || sources.length === 0) return
    const nonFacebook = sources.filter(s => s.type && s.type !== 'facebook')
    const facebookCount = sources.length - nonFacebook.length

    // Facebook groups are scanned by leadly-scout (local/server Node.js process)
    if (facebookCount > 0 && nonFacebook.length === 0) {
      setScanMsg(`קבוצות פייסבוק נסרקות אוטומטית על ידי leadly-scout — הלידים יופיעו כאן לאחר הסריקה הבאה.`)
      return
    }

    // Website / Instagram / Other sources — scan via Vercel (coming soon)
    if (nonFacebook.length > 0) {
      setScanMsg('סריקת אתרים ופורומים — בקרוב.')
      return
    }
  }

  async function approveCandidate(c: Candidate) {
    if (!businessId) return
    await supabase.from('leads').insert({
      business_id: businessId,
      name: c.name || c.summary?.slice(0, 30) || 'ליד מצייד',
      phone: c.phone || null,
      email: c.email || null,
      source: 'scrape',
      status: 'new',
      notes: [
        c.summary ? `סיכום: ${c.summary}` : '',
        c.source_name ? `קבוצה: ${c.source_name}` : '',
        c.source_link ? `קישור: ${c.source_link}` : '',
        c.raw_text ? `\nפוסט מקורי:\n${c.raw_text.slice(0, 500)}` : '',
      ].filter(Boolean).join('\n'),
    })
    await supabase.from('lead_candidates').update({ status: 'approved' }).eq('id', c.id)
    setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, status: 'approved' } : x))
    showToast('✓ ליד נוסף למערכת')
  }

  async function rejectCandidate(id: string) {
    await supabase.from('lead_candidates').update({ status: 'rejected' }).eq('id', id)
    setCandidates(prev => prev.map(x => x.id === id ? { ...x, status: 'rejected' } : x))
  }

  async function deleteCandidate(id: string) {
    await supabase.from('lead_candidates').delete().eq('id', id)
    setCandidates(prev => prev.filter(x => x.id !== id))
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 2500)
  }

  const pending  = candidates.filter(c => c.status === 'pending')
  const approved = candidates.filter(c => c.status === 'approved')
  const rejected = candidates.filter(c => c.status === 'rejected')
  const shown    = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected

  const currentTypeMeta = getTypeMeta(newType)

  return (
    <div style={{ padding: '28px', maxWidth: '900px', margin: '0 auto', direction: 'rtl' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: 'var(--success)', color: 'white', padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Crosshair size={20} style={{ color: 'var(--brand)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>צייד לידים</h1>
            <p style={{ fontSize: '12px', color: 'var(--fg-4)', margin: '2px 0 0' }}>סוכן AI שמנטר קבוצות פייסבוק ומזהה מי מחפש טיפול שיניים</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowConfig(!showConfig)} style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
            borderRadius: '9px', border: '1px solid var(--border-default)',
            background: showConfig ? 'var(--brand-soft)' : 'var(--bg-surface)',
            color: showConfig ? 'var(--brand)' : 'var(--fg-2)',
            fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer',
          }}>
            <Settings2 size={14} /> מקורות
          </button>
          <button onClick={scanAll} disabled={scanning || sources.length === 0} style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
            borderRadius: '9px', border: 'none',
            background: scanning ? 'var(--brand-soft)' : 'var(--brand)',
            color: scanning ? 'var(--brand)' : 'white',
            fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
            cursor: scanning || sources.length === 0 ? 'default' : 'pointer',
          }}>
            <Play size={14} /> {scanning ? 'מפעיל...' : 'סרוק עכשיו'}
          </button>
        </div>
      </div>

      {/* Scan status */}
      {scanMsg && (
        <div style={{ padding: '10px 16px', borderRadius: '9px', background: 'var(--info-soft)', color: 'var(--info)', border: '1px solid var(--info-border)', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={13} /> {scanMsg}
        </div>
      )}

      {/* Config panel */}
      {showConfig && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 6px' }}>מקורות לניטור</h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginBottom: '16px' }}>
            הסוכן יסרוק פייסבוק, אינסטגרם, אתרים ומאגרי מידע — וימצא מי מחפש טיפול שיניים.
          </p>

          {/* Existing sources */}
          {sources.map((s, i) => {
            const meta = getTypeMeta(s.type)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', background: 'var(--bg-sunken)', borderRadius: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', flexShrink: 0 }}>{meta.emoji}</span>
                <span style={{ fontSize: '11px', color: 'var(--fg-4)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '5px', padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap' }}>{meta.label}</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ fontSize: '11px', color: 'var(--fg-4)', direction: 'ltr', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px', whiteSpace: 'nowrap' }}>{s.url}</span>
                <button onClick={() => removeSource(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', flexShrink: 0 }}>
                  <X size={14} />
                </button>
              </div>
            )
          })}

          {/* Scheduled scanning */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 2px' }}>סריקה מתוזמנת</p>
                <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: 0 }}>הסוכן יסרוק אוטומטית לפי לוח הזמנים שקבעת</p>
              </div>
              {/* Toggle */}
              <button
                onClick={() => saveSchedule({ ...schedule, enabled: !schedule.enabled })}
                style={{
                  width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                  background: schedule.enabled ? 'var(--brand)' : 'var(--border-default)',
                  position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: '3px',
                  right: schedule.enabled ? '3px' : '21px',
                  width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                  transition: 'right 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  display: 'block',
                }} />
              </button>
            </div>

            {schedule.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>שעת סריקה יומית:</span>
                <select
                  value={schedule.scan_hour}
                  onChange={e => saveSchedule({ ...schedule, scan_hour: Number(e.target.value) })}
                  style={{
                    padding: '5px 10px', borderRadius: '8px',
                    border: '1px solid var(--border-default)',
                    background: 'var(--bg-surface)', color: 'var(--fg-1)',
                    fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', direction: 'ltr',
                  }}
                >
                  {HOUR_OPTIONS.map(h => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>בכל יום</span>
              </div>
            )}

            {schedule.enabled && (schedule.next_scan_at || schedule.last_scan_at) && (
              <div style={{ marginTop: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {schedule.next_scan_at && (
                  <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
                    ⏰ סריקה הבאה: {new Date(schedule.next_scan_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {schedule.last_scan_at && (
                  <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
                    ✓ סריקה אחרונה: {new Date(schedule.last_scan_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Add new source */}
          <div style={{ marginTop: '20px', padding: '14px', background: 'var(--bg-sunken)', borderRadius: '10px', border: '1px dashed var(--border-default)' }}>
            {/* Type selector tabs */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {SOURCE_TYPES.map(t => (
                <button key={t.value} onClick={() => setNewType(t.value)} style={{
                  padding: '5px 12px', borderRadius: '20px', border: '1px solid',
                  borderColor: newType === t.value ? 'var(--brand)' : 'var(--border-default)',
                  background: newType === t.value ? 'var(--brand-soft)' : 'var(--bg-surface)',
                  color: newType === t.value ? 'var(--brand)' : 'var(--fg-3)',
                  fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px',
                  fontWeight: newType === t.value ? 600 : 400,
                }}>
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder={`שם ה${currentTypeMeta.label}`}
                style={{ width: '160px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '12px', fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', outline: 'none' }}
              />
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSource()}
                placeholder={currentTypeMeta.placeholder}
                dir="ltr"
                style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '12px', fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', outline: 'none' }}
              />
              <button onClick={addSource} disabled={saving || !newUrl.trim()} style={{
                padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: saving || !newUrl.trim() ? 'var(--brand-soft)' : 'var(--brand)',
                color: saving || !newUrl.trim() ? 'var(--brand)' : 'white',
                fontFamily: 'inherit', fontSize: '12px', cursor: saving || !newUrl.trim() ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
              }}>
                <Plus size={13} /> {saving ? 'שומר...' : 'הוסף'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidates panel */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '14px', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
          {([
            { key: 'pending',  label: 'ממתינים לאישור', count: pending.length,  color: 'var(--warning)' },
            { key: 'approved', label: 'אושרו',           count: approved.length, color: 'var(--success)' },
            { key: 'rejected', label: 'נדחו',            count: rejected.length, color: 'var(--fg-4)' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: '12px 8px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? 'var(--bg-surface)' : 'transparent',
              color: tab === t.key ? t.color : 'var(--fg-4)',
              borderBottom: tab === t.key ? `2px solid ${t.color}` : '2px solid transparent',
            }}>
              {t.label}
              {t.count > 0 && (
                <span style={{ marginRight: '6px', background: t.color, color: 'white', borderRadius: '99px', fontSize: '10px', padding: '1px 6px', fontWeight: 700 }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        {shown.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--fg-4)' }}>
            <Crosshair size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.25 }} />
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-3)' }}>
              {tab === 'pending' ? 'אין מועמדים ממתינים' : tab === 'approved' ? 'טרם אושרו מועמדים' : 'אין מועמדים שנדחו'}
            </p>
            {tab === 'pending' && sources.length === 0 && (
              <p style={{ fontSize: '12px', marginTop: '6px' }}>הוסף מקורות ולחץ "סרוק עכשיו"</p>
            )}
            {tab === 'pending' && sources.length > 0 && (
              <button onClick={scanAll} disabled={scanning} style={{ marginTop: '14px', padding: '8px 20px', borderRadius: '9px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                <Play size={13} style={{ display: 'inline', marginLeft: '5px' }} /> סרוק עכשיו
              </button>
            )}
          </div>
        ) : (
          shown.map((c, i) => {
            const isExpanded = expanded === c.id
            return (
              <div key={c.id} style={{
                borderBottom: i < shown.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                {/* Main row */}
                <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>

                  {/* Avatar */}
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0, marginTop: '2px' }}>
                    🦷
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px', lineHeight: 1.4 }}>
                      {c.summary || c.name || 'מועמד ללא סיכום'}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {c.source_name && (
                        <span style={{ fontSize: '12px', color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          👥 {c.source_name}
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
                        {new Date(c.found_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {c.source_link && (
                        <a href={c.source_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
                          onClick={e => e.stopPropagation()}>
                          <ExternalLink size={10} /> קישור לפוסט
                        </a>
                      )}
                      {c.raw_text && (
                        <button onClick={() => setExpanded(isExpanded ? null : c.id)} style={{ fontSize: '11px', color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', fontFamily: 'inherit', padding: 0 }}>
                          <MessageSquare size={10} /> {isExpanded ? 'הסתר פוסט' : 'הצג פוסט מקורי'}
                        </button>
                      )}
                    </div>

                    {isExpanded && c.raw_text && (
                      <div style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--bg-sunken)', borderRadius: '8px', fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.6, maxHeight: '140px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                        {c.raw_text.slice(0, 800)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {tab === 'pending' && (
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginTop: '2px' }}>
                      <button onClick={() => approveCandidate(c)} style={{
                        display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px',
                        borderRadius: '8px', border: 'none', background: 'var(--success)', color: 'white',
                        fontFamily: 'inherit', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
                      }}>
                        <Check size={12} /> אשר
                      </button>
                      <button onClick={() => rejectCandidate(c.id)} style={{
                        display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px',
                        borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
                        color: 'var(--fg-3)', fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer',
                      }}>
                        <X size={12} /> דחה
                      </button>
                    </div>
                  )}
                  {tab !== 'pending' && (
                    <button onClick={() => deleteCandidate(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', padding: '4px', marginTop: '2px' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
