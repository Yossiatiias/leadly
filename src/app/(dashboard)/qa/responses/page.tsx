'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ChevronDown, Edit2, Trash2, X, Check } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'

interface QAItem {
  id: string
  question: string
  answer: string
  category: string
  audience: 'both' | 'customer' | 'staff'
  is_active: boolean
  created_at: string
}

interface Gap {
  id: string
  question: string
  asked_count: number
  last_asked_at: string
  status: 'open' | 'resolved' | 'ignored'
}

const CATEGORIES = ['כללי', 'מחירון', 'שעות ומיקום', 'שמות רופאים', 'מדיניות הנחות', 'טיפולים', 'ביטוח ומימון', 'נהלים פנימיים', 'אחר']

const AUD_META = {
  both:     { label: 'לקוחות + צוות', emoji: '👥', stripe: '#7C3AED', selBg: '#EDE9FE', selBorder: '#7C3AED', selColor: '#5B21B6', cardBg: '#EDE9FE', cardColor: '#5B21B6' },
  customer: { label: 'לקוחות',         emoji: '💬', stripe: '#16A34A', selBg: '#DCFCE7', selBorder: '#16A34A', selColor: '#14532D', cardBg: '#DCFCE7', cardColor: '#14532D' },
  staff:    { label: 'צוות בלבד',      emoji: '🔒', stripe: '#D97706', selBg: '#FEF3C7', selBorder: '#D97706', selColor: '#78350F', cardBg: '#FEF3C7', cardColor: '#78350F' },
}

function timeAgo(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (d === 0) return 'היום'
  if (d === 1) return 'אתמול'
  if (d < 7)  return `לפני ${d} ימים`
  const w = Math.floor(d / 7)
  if (w < 5)  return `לפני ${w} שבועות`
  return `לפני ${Math.floor(d / 30)} חודשים`
}

export default function QAResponsesPage() {
  const supabase = createClient()
  const { confirm, ConfirmDialog } = useConfirm()

  const [items,      setItems]      = useState<QAItem[]>([])
  const [gaps,       setGaps]       = useState<Gap[]>([])
  const [loading,    setLoading]    = useState(true)
  const [businessId, setBId]        = useState<string | null>(null)
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editItem,  setEditItem]  = useState<QAItem | null>(null)
  const [gapId,     setGapId]     = useState<string | null>(null)
  const [form, setForm] = useState({
    question: '', answer: '', category: 'כללי', audience: 'both' as 'both' | 'customer' | 'staff',
  })
  const [saving, setSaving]   = useState(false)
  const [msg,    setMsg]      = useState('')
  const [savingGap, setSavingGap] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) { setLoading(false); return }
    setBId(profile.business_id)

    const [{ data: qaData }, gapsRes] = await Promise.all([
      supabase.from('qa_knowledge').select('*')
        .eq('business_id', profile.business_id)
        .eq('type', 'qa')
        .order('created_at', { ascending: false }),
      fetch('/api/knowledge/gaps?status=open'),
    ])
    const gapsJson = await gapsRes.json()
    setItems((qaData || []) as QAItem[])
    setGaps(gapsJson.gaps || [])
    setLoading(false)
  }

  const filtered = items.filter(i => {
    if (!search) return true
    const s = search.toLowerCase()
    return i.question.toLowerCase().includes(s) || i.answer.toLowerCase().includes(s)
  })

  // פערים מוצגים באותה רשימה, למעלה — הנשאלים ביותר קודם
  const filteredGaps = gaps
    .filter(g => !search || g.question.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.asked_count || 0) - (a.asked_count || 0))

  function openAdd(prefill?: string, fromGapId?: string) {
    setEditItem(null)
    setGapId(fromGapId || null)
    setForm({ question: prefill || '', answer: '', category: 'כללי', audience: 'both' })
    setMsg('')
    setShowModal(true)
  }

  function openEdit(item: QAItem) {
    setEditItem(item)
    setGapId(null)
    setForm({ question: item.question, answer: item.answer, category: item.category, audience: item.audience })
    setMsg('')
    setShowModal(true)
  }

  function closeModal() { setShowModal(false); setMsg('') }

  async function saveQA() {
    if (!form.question.trim() || !form.answer.trim() || !businessId) return
    setSaving(true); setMsg('')
    const res = await fetch('/api/qa/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editItem?.id || null,
        business_id: businessId,
        question: form.question,
        answer: form.answer,
        category: form.category,
        audience: form.audience,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (!json.ok) { setMsg('שגיאה: ' + json.error); return }
    if (gapId) {
      await fetch('/api/knowledge/gaps', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gapId, status: 'resolved', answer: form.answer, audience: form.audience, category: form.category }),
      })
    }
    closeModal(); loadData()
  }

  async function deleteItem(id: string) {
    if (!(await confirm('למחוק שאלה זו?'))) return
    await supabase.from('qa_knowledge').delete().eq('id', id)
    loadData()
  }

  async function ignoreGap(id: string) {
    setSavingGap(id)
    await fetch('/api/knowledge/gaps', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'ignored' }),
    })
    setSavingGap(null); loadData()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--fg-3)', fontSize: '14px' }}>
      טוען...
    </div>
  )

  return (
    <div style={{ padding: '28px 36px', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>שאלות ותשובות</h1>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: '4px 0 0' }}>תשובות מדויקות שהבוט ייתן ללקוחות ולצוות</p>
        </div>
        <button onClick={() => openAdd()} style={{
          display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 18px',
          borderRadius: '10px', border: 'none', background: 'var(--brand)', color: 'white',
          fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
        }}>
          <Plus size={15} /> הוסף שאלה
        </button>
      </div>

      {/* סרגל מצב — כמה תשובות קיימות וכמה שאלות ממתינות */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '12px', padding: '5px 12px', borderRadius: '99px',
          background: 'var(--bg-sunken)', color: 'var(--fg-3)', border: '1px solid var(--border-subtle)',
        }}>
          💬 {items.length} תשובות פעילות
        </span>
        {gaps.length > 0 && (
          <span style={{
            fontSize: '12px', fontWeight: 700, padding: '5px 12px', borderRadius: '99px',
            background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D',
          }}>
            ⚠️ {gaps.length} {gaps.length === 1 ? 'שאלה ממתינה' : 'שאלות ממתינות'} לתשובה
          </span>
        )}
      </div>

      {/* ── רשימה מאוחדת: שאלות ממתינות למעלה, אחריהן התשובות ── */}
      <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי שאלה או תשובה..."
            style={{
              width: '100%', padding: '10px 14px', marginBottom: '12px',
              border: '1px solid var(--border-default)', borderRadius: '10px',
              background: 'var(--bg-surface)', color: 'var(--fg-1)',
              fontFamily: 'inherit', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
            }}
          />

          {filtered.length === 0 && filteredGaps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-default)', borderRadius: '14px', color: 'var(--fg-3)' }}>
              <p style={{ fontSize: '32px', margin: '0 0 10px' }}>💬</p>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 4px' }}>
                {search ? 'לא נמצאו שאלות' : 'אין שאלות ותשובות'}
              </p>
              <p style={{ fontSize: '13px', margin: 0 }}>{search ? 'נסה מילה אחרת' : 'לחץ על "הוסף שאלה" כדי להתחיל'}</p>
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '12px', overflow: 'hidden' }}>

              {/* שאלות שהבוט לא ידע לענות עליהן — למעלה, מודגשות */}
              {filteredGaps.map(gap => {
                const urgency = gap.asked_count >= 4 ? '#DC2626' : gap.asked_count >= 2 ? '#D97706' : '#F59E0B'
                return (
                  <div key={gap.id} style={{
                    display: 'flex', alignItems: 'center',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: '#FFFBEB',
                  }}>
                    <div style={{ width: '4px', alignSelf: 'stretch', background: urgency, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 14px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px',
                        background: urgency, color: 'white', flexShrink: 0,
                      }}>
                        דרושה תשובה
                      </span>
                      <span style={{ flex: 1, minWidth: '160px', fontSize: '13px', fontWeight: 600, color: '#78350F' }}>
                        {gap.question}
                      </span>
                      {gap.asked_count > 1 && (
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px', background: urgency + '25', color: urgency, flexShrink: 0 }}>
                          נשאלה {gap.asked_count}x
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: '#A16207', flexShrink: 0 }}>
                        {timeAgo(gap.last_asked_at)}
                      </span>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => openAdd(gap.question, gap.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '5px 12px', borderRadius: '7px', fontSize: '11px',
                            background: 'var(--brand)', border: 'none',
                            color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                          }}
                        >
                          <Plus size={11} /> כתוב תשובה
                        </button>
                        <button
                          onClick={() => ignoreGap(gap.id)}
                          disabled={savingGap === gap.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '5px 11px', borderRadius: '7px', fontSize: '11px',
                            background: 'transparent', border: '1px solid #FCD34D',
                            color: '#92400E', cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          <X size={11} /> התעלם
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}

              {filtered.map((item, idx) => {
                const isOpen = expanded === item.id
                const aud    = AUD_META[item.audience]
                const rowBg  = idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-sunken)'
                return (
                  <div key={item.id} style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div
                      onClick={() => setExpanded(isOpen ? null : item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0',
                        cursor: 'pointer', background: isOpen ? 'var(--bg-hover)' : rowBg,
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = rowBg }}
                    >
                      {/* Audience stripe */}
                      <div style={{ width: '4px', alignSelf: 'stretch', background: aud.stripe, flexShrink: 0 }} />

                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 14px' }}>
                        <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--fg-1)' }}>
                          {item.question}
                        </span>
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: 'var(--bg-hover)', color: 'var(--fg-3)', border: '1px solid var(--border-subtle)', fontWeight: 500, flexShrink: 0 }}>
                          {item.category}
                        </span>
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: aud.cardBg, color: aud.cardColor, fontWeight: 500, flexShrink: 0 }}>
                          {aud.emoji} {aud.label}
                        </span>
                        <ChevronDown size={14} style={{ color: 'var(--fg-4)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ padding: '12px 14px 14px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                        <p style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6, margin: '0 0 12px', whiteSpace: 'pre-wrap', paddingRight: '4px' }}>
                          {item.answer}
                        </p>
                        <div style={{ display: 'flex', gap: '8px', paddingRight: '4px' }}>
                          <button onClick={() => openEdit(item)} style={{
                            display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px',
                            borderRadius: '8px', border: '1px solid var(--border-default)',
                            background: 'var(--bg-surface)', color: 'var(--fg-3)',
                            cursor: 'pointer', fontFamily: 'inherit', fontSize: '11px',
                          }}>
                            <Edit2 size={11} /> עריכה
                          </button>
                          <button onClick={() => deleteItem(item.id)} style={{
                            display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px',
                            borderRadius: '8px', border: '1px solid #FECACA',
                            background: 'var(--bg-surface)', color: '#EF4444',
                            cursor: 'pointer', fontFamily: 'inherit', fontSize: '11px',
                          }}>
                            <Trash2 size={11} /> מחק
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      </>

      {/* Modal */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div style={{ background: 'var(--bg-surface)', borderRadius: '18px', width: '100%', maxWidth: '540px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)' }}>
                {editItem ? 'עריכת שאלה' : 'הוספת שאלה ותשובה'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '4px' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '22px' }}>
              <p style={lbl}>קהל יעד</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {(['both', 'customer', 'staff'] as const).map(a => {
                  const A   = AUD_META[a]
                  const sel = form.audience === a
                  return (
                    <button key={a} onClick={() => setForm(f => ({ ...f, audience: a }))} style={{
                      padding: '12px 8px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                      border: `2px solid ${sel ? A.selBorder : 'var(--border-subtle)'}`,
                      background: sel ? A.selBg : 'var(--bg-surface)',
                      transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: '20px', display: 'block', marginBottom: '5px' }}>{A.emoji}</span>
                      <span style={{ fontSize: '11px', fontWeight: sel ? 700 : 400, color: sel ? A.selColor : 'var(--fg-3)', display: 'block' }}>{A.label}</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ marginBottom: '14px' }}>
                <p style={lbl}>קטגוריה</p>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-base" style={{ width: '100%' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <p style={lbl}>שאלה</p>
                <input value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} placeholder="לדוגמה: מה שעות הפעילות?" className="input-base" style={{ width: '100%' }} />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <p style={lbl}>תשובה</p>
                <textarea value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} rows={5} className="input-base" style={{ width: '100%', resize: 'vertical' }} placeholder="כתוב את התשובה שהבוט ייתן..." />
              </div>

              {msg && <p style={{ fontSize: '12px', color: '#EF4444', margin: '8px 0 0', fontWeight: 600 }}>{msg}</p>}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={closeModal} className="btn-ghost">ביטול</button>
                <button
                  onClick={saveQA}
                  disabled={saving || !form.question.trim() || !form.answer.trim()}
                  className="btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: (saving || !form.question.trim() || !form.answer.trim()) ? 0.6 : 1 }}
                >
                  <Check size={13} />{saving ? 'שומר...' : editItem ? 'עדכן' : 'שמור'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 6px',
}
