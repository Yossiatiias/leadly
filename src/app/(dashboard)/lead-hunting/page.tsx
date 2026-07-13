'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Check, X, Crosshair, Settings2, Play, Phone, Mail, ExternalLink, Clock, Trash2 } from 'lucide-react'

interface Candidate {
  id: string
  business_id: string
  source_url: string
  name: string | null
  phone: string | null
  email: string | null
  status: 'pending' | 'approved' | 'rejected'
  found_at: string
}

interface HuntSource {
  url: string
  label: string
}

export default function LeadHuntingPage() {
  const supabase = createClient()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sources, setSources] = useState<HuntSource[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
      if (!profile?.business_id) return
      setBusinessId(profile.business_id)

      // Load sources from business settings
      const { data: biz } = await supabase.from('businesses').select('settings').eq('id', profile.business_id).single()
      setSources(biz?.settings?.hunt_sources || [])

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

  async function saveSources() {
    if (!businessId) return
    setSaving(true)
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
    await supabase.from('businesses').update({ settings: { ...(biz?.settings || {}), hunt_sources: sources } }).eq('id', businessId)
    setSaving(false)
    showToast('הגדרות נשמרו')
    setShowConfig(false)
  }

  function addSource() {
    if (!newUrl.trim()) return
    const label = newLabel.trim() || new URL(newUrl.startsWith('http') ? newUrl : 'https://' + newUrl).hostname
    setSources(prev => [...prev, { url: newUrl.trim(), label }])
    setNewUrl(''); setNewLabel('')
  }

  async function scanSource(url: string) {
    if (!businessId) return
    setScanning(true); setScanMsg(`סורק: ${url}`)
    try {
      const res = await fetch('/api/lead-hunting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, business_id: businessId, save: true }),
      })
      const data = await res.json()
      if (data.error) { setScanMsg('שגיאה: ' + data.error) }
      else {
        setScanMsg(`נמצאו ${data.saved || 0} מועמדים חדשים מ-${url}`)
        await loadCandidates(businessId)
      }
    } catch { setScanMsg('שגיאת חיבור') }
    setScanning(false)
  }

  async function scanAll() {
    for (const src of sources) {
      await scanSource(src.url)
    }
  }

  async function approveCandidate(c: Candidate) {
    if (!businessId) return
    // Create lead
    await supabase.from('leads').insert({
      business_id: businessId,
      name: c.name || c.phone || c.email || 'ליד מציד',
      phone: c.phone || null,
      email: c.email || null,
      source: 'scrape',
      status: 'new',
      notes: `מקור ציד: ${c.source_url}`,
    })
    // Mark approved
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
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>ציד לידים</h1>
            <p style={{ fontSize: '12px', color: 'var(--fg-4)', margin: '2px 0 0' }}>סוכן AI שסורק דפים ומביא מועמדים לאישורך</p>
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
            <Settings2 size={14} /> הגדרות
          </button>
          <button onClick={scanAll} disabled={scanning || sources.length === 0} style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
            borderRadius: '9px', border: 'none',
            background: scanning ? 'var(--brand-soft)' : 'var(--brand)',
            color: scanning ? 'var(--brand)' : 'white',
            fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: scanning || sources.length === 0 ? 'default' : 'pointer',
          }}>
            <Play size={14} /> {scanning ? 'סורק...' : 'סרוק עכשיו'}
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
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 14px' }}>
            דפים וקבוצות לסריקה
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginBottom: '14px' }}>
            הסוכן יסרוק דפים אלה ויביא מועמדים לאישורך. מתאים לדפי פייסבוק ציבוריים, Yad2, אתרי עסקים וכל URL פומבי.
          </p>

          {/* Source list */}
          {sources.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', background: 'var(--bg-sunken)', borderRadius: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', flex: 1 }}>{s.label}</span>
              <span style={{ fontSize: '11px', color: 'var(--fg-4)', direction: 'ltr', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px', whiteSpace: 'nowrap' }}>{s.url}</span>
              <button onClick={() => { scanSource(s.url) }} disabled={scanning} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'var(--brand)', color: 'white', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>
                סרוק
              </button>
              <button onClick={() => setSources(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex' }}>
                <X size={14} />
              </button>
            </div>
          ))}

          {/* Add source */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="שם (למשל: פייסבוק קבוצה א)" style={{ width: '160px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '12px', fontFamily: 'inherit', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none' }} />
            <input value={newUrl} onChange={e => setNewUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSource()} placeholder="https://facebook.com/groups/..." dir="ltr" style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '12px', fontFamily: 'inherit', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none' }} />
            <button onClick={addSource} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Plus size={13} /> הוסף
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button onClick={saveSources} disabled={saving} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              {saving ? 'שומר...' : 'שמור הגדרות'}
            </button>
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
              transition: 'all 0.15s',
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
              <p style={{ fontSize: '12px', marginTop: '6px' }}>הוסף דפים בהגדרות ולחץ "סרוק עכשיו"</p>
            )}
            {tab === 'pending' && sources.length > 0 && (
              <button onClick={scanAll} disabled={scanning} style={{ marginTop: '14px', padding: '8px 20px', borderRadius: '9px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                <Play size={13} style={{ display: 'inline', marginLeft: '5px' }} /> סרוק עכשיו
              </button>
            )}
          </div>
        ) : (
          shown.map((c, i) => (
            <div key={c.id} style={{
              padding: '14px 20px',
              borderBottom: i < shown.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex', alignItems: 'center', gap: '14px',
            }}>
              {/* Avatar */}
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>
                {c.phone ? '📱' : c.email ? '✉️' : '👤'}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  {c.name && <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)' }}>{c.name}</span>}
                  {c.phone && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--fg-2)', direction: 'ltr' }}>
                      <Phone size={12} style={{ color: 'var(--success)' }} /> {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--fg-3)' }}>
                      <Mail size={12} style={{ color: 'var(--brand)' }} /> {c.email}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                  <ExternalLink size={10} style={{ color: 'var(--fg-4)' }} />
                  <span style={{ fontSize: '11px', color: 'var(--fg-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px', direction: 'ltr' }}>
                    {c.source_url}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>·</span>
                  <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>
                    {new Date(c.found_at).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>

              {/* Actions */}
              {tab === 'pending' && (
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
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
                <button onClick={() => deleteCandidate(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', padding: '4px' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* SQL note */}
      {candidates.length === 0 && !showConfig && (
        <div style={{ marginTop: '16px', padding: '14px 16px', background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: '10px', fontSize: '12px', color: 'var(--warning)' }}>
          <strong>הערה:</strong> הפעם הראשונה שמשתמשים בתכונה זו, יש להריץ בסופאבייס:<br />
          <code style={{ fontSize: '11px', display: 'block', marginTop: '6px', background: 'rgba(0,0,0,0.06)', padding: '6px 10px', borderRadius: '6px', direction: 'ltr' }}>
            {`CREATE TABLE IF NOT EXISTS lead_candidates (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, business_id UUID, source_url TEXT, name TEXT, phone TEXT, email TEXT, status TEXT DEFAULT 'pending', found_at TIMESTAMPTZ DEFAULT NOW());`}
          </code>
        </div>
      )}
    </div>
  )
}
