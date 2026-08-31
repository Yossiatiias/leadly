'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Plus, ChevronDown } from 'lucide-react'

interface Msg { role: 'user' | 'bot'; text: string; isGap?: boolean; gapQ?: string }

const QUICK_QUESTIONS = [
  'מה ההנחה המקסימלית שאני יכול לתת?',
  'מה שעות הפעילות?',
  'מה יש לי בתור להיום?',
]

export default function StaffChatWidget({ businessId }: { businessId: string }) {
  const [open, setOpen]           = useState(false)
  const [msgs, setMsgs]           = useState<Msg[]>([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [addedGaps, setAddedGaps] = useState<Set<string>>(new Set())
  const endRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function send(overrideQ?: string) {
    const q = (overrideQ ?? input).trim()
    if (!q || loading) return
    setInput('')
    const newMsgs: Msg[] = [...msgs, { role: 'user', text: q }]
    setMsgs(newMsgs)
    setLoading(true)

    const res  = await fetch('/api/knowledge/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, business_id: businessId, history: msgs }),
    })
    const json = await res.json()
    const answer = json.answer || 'שגיאה — נסה שוב'
    const isGap  = answer.includes('לא מצאתי') || answer.includes('אין מידע') || answer.includes('ריקה עדיין')

    setMsgs([...newMsgs, { role: 'bot', text: answer, isGap, gapQ: isGap ? q : undefined }])
    setLoading(false)
  }

  async function addToKb(question: string) {
    setAddedGaps(s => new Set([...s, question]))
    await fetch('/api/knowledge/gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, question }),
    })
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="בוט פנימי לצוות — שאל כשלקוח שואל ואין לך תשובה"
          style={{
            position: 'fixed', bottom: '28px', left: '28px', zIndex: 200,
            height: '46px', padding: '0 18px 0 14px',
            borderRadius: '99px',
            background: '#6D28D9',
            border: '2px solid #7C3AED',
            cursor: 'pointer', color: 'white',
            boxShadow: '0 4px 16px rgba(109,40,217,0.35)',
            display: 'flex', alignItems: 'center', gap: '8px',
            transition: 'transform 0.15s, box-shadow 0.15s, background 0.15s',
            direction: 'rtl',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.transform = 'translateY(-2px)'
            b.style.boxShadow = '0 6px 22px rgba(109,40,217,0.5)'
            b.style.background = '#5B21B6'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.transform = 'translateY(0)'
            b.style.boxShadow = '0 4px 16px rgba(109,40,217,0.35)'
            b.style.background = '#6D28D9'
          }}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>💡</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1.2 }}>לקוח שאל ואין לך תשובה?</span>
            <span style={{ fontSize: '10px', opacity: 0.8, lineHeight: 1.2 }}>שאל את הבוט הפנימי</span>
          </div>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '28px', left: '28px', zIndex: 200,
          width: '370px', height: '520px',
          borderRadius: '18px', border: '1px solid #7C3AED40',
          background: 'var(--bg-surface)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          direction: 'rtl',
        }}>

          {/* Header */}
          <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, #6D28D9, #4F46E5)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <span style={{ fontSize: '20px' }}>💡</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, color: 'white', fontSize: '13px' }}>עוזר פנימי — צוות</p>
              <p style={{ margin: 0, fontSize: '10px', color: '#C4B5FD' }}>מידע ארגוני · ליד לפי טלפון · תורים להיום</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}
            >
              <ChevronDown size={15} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {msgs.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ textAlign: 'center', padding: '20px 16px 10px', color: 'var(--fg-3)' }}>
                  <p style={{ fontSize: '26px', margin: '0 0 6px' }}>💡</p>
                  <p style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 2px', color: 'var(--fg-2)' }}>שאל שאלה ארגונית</p>
                  <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: 0, lineHeight: 1.5 }}>
                    כתוב שאלה חופשית, או הדבק מספר טלפון<br />לחיפוש מידע על ליד ספציפי
                  </p>
                </div>

                {/* Quick question chips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '0 2px' }}>
                  {QUICK_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      style={{
                        textAlign: 'right', padding: '8px 12px', borderRadius: '10px',
                        border: '1px solid #DDD6FE', background: '#F5F3FF',
                        color: '#5B21B6', fontSize: '11px', fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#EDE9FE')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#F5F3FF')}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '90%', padding: '9px 12px',
                  borderRadius: m.role === 'user' ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
                  fontSize: '12px', lineHeight: 1.6,
                  background: m.role === 'user' ? 'var(--bg-sunken)' : m.isGap ? '#FFFBEB' : '#6D28D9',
                  color: m.role === 'user' ? 'var(--fg-1)' : m.isGap ? '#92400E' : 'white',
                  border: m.isGap ? '1px solid #FDE68A' : 'none',
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.text}
                </div>
                {m.isGap && m.gapQ && !addedGaps.has(m.gapQ) && (
                  <button
                    onClick={() => addToKb(m.gapQ!)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#6D28D9', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '99px', padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                  >
                    <Plus size={10} /> הוסף לפערי ידע
                  </button>
                )}
                {m.isGap && m.gapQ && addedGaps.has(m.gapQ) && (
                  <span style={{ fontSize: '10px', color: '#16A34A', fontWeight: 600 }}>✓ נוסף לפערי ידע</span>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: 'flex-end' }}>
                <div style={{ padding: '9px 14px', borderRadius: '12px 12px 3px 12px', background: '#6D28D9', color: 'white', fontSize: '12px', opacity: 0.8 }}>
                  חושב...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '7px', background: 'var(--bg-surface)', flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="שאלה ארגונית או מספר טלפון של ליד..."
              disabled={loading}
              style={{ flex: 1, padding: '8px 11px', borderRadius: '9px', border: '1px solid var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-1)', fontFamily: 'inherit', fontSize: '12px' }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              style={{ width: '36px', height: '36px', borderRadius: '9px', border: 'none', background: '#6D28D9', color: 'white', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: !input.trim() ? 0.5 : 1, flexShrink: 0 }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
