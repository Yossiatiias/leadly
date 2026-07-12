'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Plus, ChevronDown } from 'lucide-react'

interface Msg { role: 'user' | 'bot'; text: string; isGap?: boolean; gapQ?: string }

export default function StaffChatWidget({ businessId }: { businessId: string }) {
  const [open, setOpen]         = useState(false)
  const [msgs, setMsgs]         = useState<Msg[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [addedGaps, setAddedGaps] = useState<Set<string>>(new Set())
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function send() {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setMsgs(m => [...m, { role: 'user', text: q }])
    setLoading(true)

    const res  = await fetch('/api/knowledge/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, business_id: businessId }),
    })
    const json = await res.json()
    const answer = json.answer || 'שגיאה — נסה שוב'
    const isGap  = answer.includes('לא מצאתי') || answer.includes('אין מידע')

    setMsgs(m => [...m, { role: 'bot', text: answer, isGap, gapQ: isGap ? q : undefined }])
    setLoading(false)
  }

  async function addToKb(question: string) {
    setAddedGaps(s => new Set([...s, question]))
    await fetch('/api/knowledge/gaps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, question }),
    })
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="צ'אט פנימי לצוות"
          style={{
            position: 'fixed', bottom: '28px', left: '28px', zIndex: 200,
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #6D28D9, #4F46E5)',
            border: 'none', cursor: 'pointer', color: 'white',
            fontSize: '22px', boxShadow: '0 4px 18px rgba(109,40,217,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget
            b.style.transform = 'scale(1.08)'
            b.style.boxShadow = '0 6px 24px rgba(109,40,217,0.55)'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget
            b.style.transform = 'scale(1)'
            b.style.boxShadow = '0 4px 18px rgba(109,40,217,0.4)'
          }}
        >
          👥
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '28px', left: '28px', zIndex: 200,
          width: '360px', height: '500px',
          borderRadius: '18px', border: '1px solid #7C3AED40',
          background: 'var(--bg-surface)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          direction: 'rtl',
        }}>

          {/* Header */}
          <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, #6D28D9, #4F46E5)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>👥</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, color: 'white', fontSize: '13px' }}>בוט פנימי — צוות</p>
              <p style={{ margin: 0, fontSize: '10px', color: '#C4B5FD' }}>עונה לפי מידע פנימי וציבורי</p>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
              <ChevronDown size={15} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--fg-3)' }}>
                <p style={{ fontSize: '28px', margin: '0 0 8px' }}>👥</p>
                <p style={{ fontSize: '13px', fontWeight: 500, margin: '0 0 3px', color: 'var(--fg-2)' }}>שאל שאלה ארגונית</p>
                <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: 0, lineHeight: 1.5 }}>מה ההנחה המקסימלית?<br />מה שם הרופא המומחה ביישור?</p>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '88%', padding: '9px 12px', borderRadius: m.role === 'user' ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
                  fontSize: '12px', lineHeight: 1.55,
                  background: m.role === 'user' ? 'var(--bg-sunken)' : m.isGap ? '#FFFBEB' : '#6D28D9',
                  color: m.role === 'user' ? 'var(--fg-1)' : m.isGap ? '#92400E' : 'white',
                  border: m.isGap ? '1px solid #FDE68A' : 'none',
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
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '7px', background: 'var(--bg-surface)' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="שאל שאלה ארגונית..."
              disabled={loading}
              style={{ flex: 1, padding: '8px 11px', borderRadius: '9px', border: '1px solid var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-1)', fontFamily: 'inherit', fontSize: '12px' }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              style={{ width: '36px', height: '36px', borderRadius: '9px', border: 'none', background: '#6D28D9', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: !input.trim() ? 0.5 : 1 }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
