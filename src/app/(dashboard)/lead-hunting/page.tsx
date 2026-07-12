'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, Check, ExternalLink, Phone, Mail, AlertCircle, Crosshair } from 'lucide-react'

interface LeadCandidate {
  phone?: string
  email?: string
  name?: string
}

export default function LeadHuntingPage() {
  const supabase = createClient()
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<LeadCandidate[]>([])
  const [added, setAdded] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
      setBusinessId(profile?.business_id || null)
    }
    load()
  }, [])

  async function scan() {
    if (!url.trim()) return
    setScanning(true)
    setCandidates([])
    setAdded(new Set())
    setError('')
    try {
      const res = await fetch('/api/lead-hunting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (data.error) setError(data.error)
      else setCandidates(data.candidates || [])
    } catch {
      setError('שגיאה בחיבור לשרת')
    }
    setScanning(false)
  }

  async function addLead(c: LeadCandidate, i: number) {
    if (!businessId) return
    const { error: err } = await supabase.from('leads').insert({
      business_id: businessId,
      name: c.name || c.phone || c.email || 'ליד מציד',
      phone: c.phone || null,
      email: c.email || null,
      source: 'scrape',
      status: 'new',
      notes: `מקור ציד: ${url}`,
    })
    if (!err) {
      setAdded(prev => new Set([...prev, i]))
      setToast('✓ ליד נוסף למערכת')
      setTimeout(() => setToast(''), 2500)
    }
  }

  return (
    <div style={{ padding: '28px', maxWidth: '760px', margin: '0 auto', direction: 'rtl' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--success)', color: 'white', padding: '10px 20px',
          borderRadius: '10px', fontSize: '13px', fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Crosshair size={18} style={{ color: 'var(--brand)' }} />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>ציד לידים</h1>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0 }}>
          הזן כתובת URL של עמוד פייסבוק, אתר, או כל דף ווב — המערכת תחלץ פרטי יצירת קשר אוטומטית
        </p>
      </div>

      {/* Search bar */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '8px' }}>
          כתובת הדף לסריקה
        </label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder="https://www.facebook.com/... או כל כתובת אתר"
            dir="ltr"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '9px',
              border: '1px solid var(--border-default)', fontSize: '13px',
              fontFamily: 'inherit', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none',
            }}
          />
          <button
            onClick={scan}
            disabled={scanning || !url.trim()}
            style={{
              padding: '10px 20px', borderRadius: '9px', border: 'none', cursor: scanning ? 'default' : 'pointer',
              background: scanning ? 'var(--brand-soft)' : 'var(--brand)',
              color: scanning ? 'var(--brand)' : 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
              display: 'flex', alignItems: 'center', gap: '7px',
              transition: 'all 0.15s',
            }}
          >
            <Search size={14} />
            {scanning ? 'סורק...' : 'סרוק'}
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: '8px', margin: '8px 0 0' }}>
          הסריקה מחלצת מספרי טלפון ואימייל מהדף. לידים שנוצרו יסומנו עם מקור "ציד לידים".
        </p>
      </div>

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: '10px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', fontSize: '13px', marginBottom: '16px' }}>
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* Results */}
      {candidates.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>
              נמצאו {candidates.length} תוצאות
            </h2>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
              פתח מקור <ExternalLink size={12} />
            </a>
          </div>
          <div>
            {candidates.map((c, i) => {
              const isAdded = added.has(i)
              return (
                <div key={i} style={{
                  padding: '14px 20px',
                  borderBottom: i < candidates.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  background: isAdded ? 'var(--success-soft)' : 'transparent',
                  transition: 'background 0.2s',
                }}>
                  <div style={{ flex: 1, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {c.name && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--fg-1)', fontWeight: 500 }}>
                        <span style={{ fontSize: '14px' }}>👤</span> {c.name}
                      </span>
                    )}
                    {c.phone && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--fg-2)' }}>
                        <Phone size={13} style={{ color: 'var(--success)' }} /> {c.phone}
                      </span>
                    )}
                    {c.email && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--fg-2)' }}>
                        <Mail size={13} style={{ color: 'var(--brand)' }} /> {c.email}
                      </span>
                    )}
                    {!c.phone && !c.email && !c.name && (
                      <span style={{ fontSize: '12px', color: 'var(--fg-4)' }}>אין פרטים</span>
                    )}
                  </div>
                  <button
                    onClick={() => addLead(c, i)}
                    disabled={isAdded}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
                      borderRadius: '8px', border: 'none', cursor: isAdded ? 'default' : 'pointer',
                      background: isAdded ? 'var(--success)' : 'var(--brand)',
                      color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '12px',
                      flexShrink: 0, transition: 'all 0.2s',
                    }}
                  >
                    {isAdded ? <><Check size={12} /> נוסף</> : <><Plus size={12} /> הוסף</>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!scanning && candidates.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--fg-4)' }}>
          <Crosshair size={48} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
          <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--fg-3)', margin: '0 0 6px' }}>הזן כתובת URL כדי להתחיל</p>
          <p style={{ fontSize: '12px', margin: 0 }}>המערכת תחלץ מספרי טלפון ואימייל מהדף שתבחר</p>
        </div>
      )}
    </div>
  )
}
