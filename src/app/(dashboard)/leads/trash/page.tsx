'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getDisplayName, type Lead } from '@/types'
import { ArrowRight, RotateCcw, Trash2, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function LeadsTrashPage() {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<Set<string>>(new Set())
  const [showEmptyModal, setShowEmptyModal] = useState(false)
  const [password, setPassword] = useState('')
  const [emptying, setEmptying] = useState(false)
  const [emptyError, setEmptyError] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('leads').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  async function restore(id: string) {
    setRestoring(prev => new Set([...prev, id]))
    const { error } = await supabase.from('leads').update({ deleted_at: null }).eq('id', id)
    setRestoring(prev => { const s = new Set(prev); s.delete(id); return s })
    if (error) { alert('שחזור נכשל: ' + error.message); return }
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  // ריקון סל המחזור — פעולה בלתי הפיכה, לכן דורשת אימות סיסמה אמיתי מול
  // Supabase (לא סיסמה מומצאת שנבדקת בקוד) לפני שמוחקים משהו לצמיתות
  async function emptyTrash() {
    setEmptyError('')
    if (!password) { setEmptyError('יש להזין סיסמה'); return }
    setEmptying(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) { setEmptyError('לא נמצא משתמש מחובר'); return }

      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password })
      if (authError) { setEmptyError('סיסמה שגויה'); return }

      const ids = leads.map(l => l.id)
      await supabase.from('lead_files').delete().in('lead_id', ids)
      await supabase.from('lead_activities').delete().in('lead_id', ids)
      const { error } = await supabase.from('leads').delete().in('id', ids)
      if (error) { setEmptyError('המחיקה נכשלה: ' + error.message); return }

      setLeads([])
      setShowEmptyModal(false)
      setPassword('')
    } finally {
      setEmptying(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען...</p>
    </div>
  )

  return (
    <div style={{ padding: '22px 26px', direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--fg-4)', marginBottom: '18px' }}>
        <Link href="/leads" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--fg-3)', textDecoration: 'none' }}>
          <ArrowRight size={13} /> מאגר פונים
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>סל מחזור</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '3px' }}>סל מחזור</h1>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)' }}>{leads.length} לידים בסל המחזור</p>
        </div>
        {leads.length > 0 && (
          <button onClick={() => setShowEmptyModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--danger-soft)', color: 'var(--danger)',
            border: '1px solid var(--danger-border)', fontWeight: 600, padding: '9px 16px', borderRadius: 'var(--radius-md)',
            fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Trash2 size={14} /> ריקון סל המחזור
          </button>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="card" style={{ padding: '60px 0', textAlign: 'center' }}>
          <Trash2 size={30} style={{ color: 'var(--fg-4)', margin: '0 auto 10px', display: 'block' }} />
          <p style={{ color: 'var(--fg-3)', fontWeight: 500, fontSize: '14px' }}>סל המחזור ריק</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {leads.map((lead, i) => (
            <div key={lead.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: i < leads.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)' }}>{getDisplayName(lead) || lead.phone || '—'}</p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--fg-4)' }}>
                  נמחק {lead.deleted_at ? fmtDate(lead.deleted_at) : ''}
                </p>
              </div>
              <button onClick={() => restore(lead.id)} disabled={restoring.has(lead.id)} style={{
                display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--brand-soft)', color: 'var(--brand)',
                border: 'none', fontWeight: 600, padding: '6px 13px', borderRadius: '20px', fontSize: '12px',
                cursor: restoring.has(lead.id) ? 'default' : 'pointer', opacity: restoring.has(lead.id) ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                <RotateCcw size={12} /> {restoring.has(lead.id) ? 'משחזר...' : 'שחזר'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─── חלון ריקון — דורש אימות סיסמה ─── */}
      {showEmptyModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget && !emptying) { setShowEmptyModal(false); setPassword(''); setEmptyError('') } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }}
        >
          <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '22px 24px', width: '360px', maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                <AlertTriangle size={17} style={{ color: 'var(--danger)' }} /> ריקון סל המחזור
              </h3>
              <button onClick={() => { setShowEmptyModal(false); setPassword(''); setEmptyError('') }} disabled={emptying}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '2px', display: 'flex' }}>
                <X size={17} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--fg-3)', lineHeight: 1.6 }}>
              פעולה זו תמחק לצמיתות את {leads.length} הלידים בסל המחזור — לא ניתן לבטל. הזן את הסיסמה שלך לאישור.
            </p>

            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') emptyTrash() }}
              placeholder="הסיסמה שלך"
              className="input-base"
              style={{ width: '100%', marginBottom: '8px' }}
              autoFocus
            />
            {emptyError && <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--danger)' }}>{emptyError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={emptyTrash} disabled={emptying || !password} style={{
                flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                background: emptying || !password ? 'var(--border-default)' : 'var(--danger)',
                color: emptying || !password ? 'var(--fg-3)' : 'white',
                fontWeight: 600, fontSize: '13px', fontFamily: 'inherit',
                cursor: emptying || !password ? 'default' : 'pointer',
              }}>
                {emptying ? 'מוחק...' : 'מחק לצמיתות'}
              </button>
              <button onClick={() => { setShowEmptyModal(false); setPassword(''); setEmptyError('') }} disabled={emptying} className="btn-ghost" style={{ padding: '0 18px' }}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
