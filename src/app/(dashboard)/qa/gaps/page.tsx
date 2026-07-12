'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle, XCircle, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react'

interface Gap {
  id: string
  question: string
  asked_count: number
  last_asked_at: string
  status: 'open' | 'resolved' | 'ignored'
  created_at: string
}

const ITEM_CATEGORIES = ['כללי', 'מחירון', 'שעות ומיקום', 'שמות רופאים', 'מדיניות הנחות', 'טיפולים', 'ביטוח ומימון', 'נהלים פנימיים', 'אחר']

const AUD = {
  both:     { label: 'לקוחות + צוות', emoji: '🔵', bg: '#EFF6FF', color: '#1E3A8A' },
  customer: { label: 'בוט לקוחות',    emoji: '🤖', bg: '#ECFDF5', color: '#065F46' },
  staff:    { label: 'צוות בלבד',     emoji: '👥', bg: '#F5F3FF', color: '#4C1D95' },
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `לפני ${d} ימים`
  if (h > 0) return `לפני ${h} שעות`
  return 'לפני פחות משעה'
}

export default function GapsPage() {
  const router = useRouter()
  const [gaps, setGaps]         = useState<Gap[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'open' | 'resolved' | 'ignored' | 'all'>('open')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [answers, setAnswers]   = useState<Record<string, string>>({})
  const [audiences, setAudiences] = useState<Record<string, 'both'|'customer'|'staff'>>({})
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState<string | null>(null)

  useEffect(() => { loadGaps() }, [filter])

  async function loadGaps() {
    setLoading(true)
    const res = await fetch(`/api/knowledge/gaps?status=${filter}`)
    const json = await res.json()
    setGaps(json.gaps || [])
    setLoading(false)
  }

  async function resolve(id: string) {
    const answer = answers[id]?.trim()
    if (!answer) return
    setSaving(id)
    await fetch('/api/knowledge/gaps', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'resolved', answer, audience: audiences[id] || 'both', category: categories[id] || 'כללי' }),
    })
    setSaving(null); setExpanded(null); loadGaps()
  }

  async function ignore(id: string) {
    setSaving(id)
    await fetch('/api/knowledge/gaps', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'ignored' }),
    })
    setSaving(null); loadGaps()
  }

  const open     = gaps.filter(g => g.status === 'open').length
  const resolved = gaps.filter(g => g.status === 'resolved').length

  return (
    <div style={{ padding: '28px 36px', maxWidth: '760px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '6px' }}>
        <button onClick={() => router.push('/qa')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', padding: '4px 0' }}>
          <ArrowRight size={15} /> מאגר ידע
        </button>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: '0 0 5px' }}>פערי ידע 🕳️</h1>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0, lineHeight: 1.5 }}>
          שאלות שלקוחות שאלו את הבוט — והבוט לא ידע לענות עליהן.<br />
          הוסף תשובה ובפעם הבאה הבוט כבר ידע.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {[
          { n: open,     label: 'שאלות פתוחות', color: '#DC2626', bg: '#FEF2F2' },
          { n: resolved, label: 'נפתרו',          color: '#16A34A', bg: '#F0FDF4' },
          { n: gaps.filter(g => g.asked_count > 1).length, label: 'נשאלו פעמיים+', color: '#D97706', bg: '#FFFBEB' },
        ].map((s, i) => (
          <div key={i} style={{ padding: '14px 16px', borderRadius: '12px', background: s.bg, border: `1px solid ${s.color}30` }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: s.color, marginBottom: '2px' }}>{s.n}</div>
            <div style={{ fontSize: '12px', color: 'var(--fg-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: 'var(--bg-sunken)', padding: '4px', borderRadius: '10px' }}>
        {([
          { key: 'open',     label: 'פתוחות' },
          { key: 'resolved', label: 'טופלו' },
          { key: 'ignored',  label: 'הוסתרו' },
          { key: 'all',      label: 'הכל' },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            flex: 1, padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '12px', fontWeight: filter === f.key ? 600 : 400,
            background: filter === f.key ? 'var(--bg-surface)' : 'transparent',
            color: filter === f.key ? 'var(--fg-1)' : 'var(--fg-3)',
            boxShadow: filter === f.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}>{f.label}</button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--fg-3)' }}>טוען...</div>
      ) : gaps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-default)', borderRadius: '14px' }}>
          <p style={{ fontSize: '36px', margin: '0 0 10px' }}>✅</p>
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 4px' }}>
            {filter === 'open' ? 'אין שאלות פתוחות' : 'אין פריטים'}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0 }}>
            {filter === 'open' ? 'הבוט מכסה את כל השאלות שנשאלו עד כה' : ''}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {gaps.map(gap => {
            const isOpen = expanded === gap.id
            const urgency = gap.asked_count >= 4 ? '#DC2626' : gap.asked_count >= 2 ? '#D97706' : '#9CA3AF'

            return (
              <div key={gap.id} style={{
                borderRadius: '12px', border: `1px solid var(--border-subtle)`,
                borderRight: `3px solid ${urgency}`,
                background: 'var(--bg-surface)', overflow: 'hidden',
                boxShadow: isOpen ? '0 4px 16px rgba(0,0,0,0.06)' : 'none',
              }}>
                {/* Row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : gap.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer' }}
                >
                  <MessageCircle size={16} style={{ color: urgency, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)' }}>
                    {gap.question}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                    {gap.asked_count > 1 && (
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: urgency + '20', color: urgency }}>
                        נשאל {gap.asked_count} פעמים
                      </span>
                    )}
                    <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>{timeAgo(gap.last_asked_at)}</span>
                    {isOpen ? <ChevronUp size={15} style={{ color: 'var(--fg-4)' }} /> : <ChevronDown size={15} style={{ color: 'var(--fg-4)' }} />}
                  </div>
                </div>

                {/* Expanded form */}
                {isOpen && gap.status === 'open' && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', margin: '14px 0 8px' }}>הוסף תשובה למאגר הידע:</p>

                    {/* Audience */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '7px', marginBottom: '12px' }}>
                      {(['both', 'customer', 'staff'] as const).map(a => {
                        const A = AUD[a]
                        const sel = (audiences[gap.id] || 'both') === a
                        return (
                          <button key={a} onClick={() => setAudiences(p => ({ ...p, [gap.id]: a }))} style={{
                            padding: '8px 6px', borderRadius: '9px', border: `2px solid ${sel ? A.color + '60' : 'var(--border-subtle)'}`,
                            background: sel ? A.bg : 'var(--bg-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                          }}>
                            <span style={{ fontSize: '16px', display: 'block', marginBottom: '2px' }}>{A.emoji}</span>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: sel ? A.color : 'var(--fg-3)' }}>{A.label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Category */}
                    <select
                      value={categories[gap.id] || 'כללי'}
                      onChange={e => setCategories(p => ({ ...p, [gap.id]: e.target.value }))}
                      className="input-base" style={{ width: '100%', marginBottom: '10px' }}
                    >
                      {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {/* Answer */}
                    <textarea
                      value={answers[gap.id] || ''}
                      onChange={e => setAnswers(p => ({ ...p, [gap.id]: e.target.value }))}
                      placeholder="כתוב את התשובה שהבוט ייתן בפעם הבאה שישאלו שאלה זו..."
                      rows={4} className="input-base" style={{ width: '100%', resize: 'vertical', marginBottom: '12px' }}
                    />

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => ignore(gap.id)}
                        disabled={saving === gap.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', borderRadius: '9px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', color: 'var(--fg-3)' }}
                      >
                        <XCircle size={13} /> הסתר
                      </button>
                      <button
                        onClick={() => resolve(gap.id)}
                        disabled={saving === gap.id || !answers[gap.id]?.trim()}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '9px', border: 'none', background: saving === gap.id ? 'var(--fg-4)' : '#16A34A', color: 'white', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, opacity: !answers[gap.id]?.trim() ? 0.5 : 1 }}
                      >
                        <CheckCircle size={13} />
                        {saving === gap.id ? 'שומר...' : 'שמור ואמן את הבוט'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Resolved state */}
                {isOpen && gap.status !== 'open' && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', background: gap.status === 'resolved' ? '#F0FDF4' : 'var(--bg-sunken)' }}>
                    <p style={{ fontSize: '12px', color: gap.status === 'resolved' ? '#16A34A' : 'var(--fg-3)', fontWeight: 500, margin: 0 }}>
                      {gap.status === 'resolved' ? '✅ תשובה נוספה למאגר הידע' : '🙈 הוסתר'}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
