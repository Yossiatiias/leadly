'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import { Send, MessageSquare, Search } from 'lucide-react'

interface Message {
  id: string
  created_at: string
  sender_id: string
  receiver_id: string
  content: string
  read_at: string | null
}

export default function MessagesPage() {
  const supabase = createClient()
  const [me, setMe] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load current user + all profiles
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: myProfile }, { data: allProfiles }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('*').neq('id', user.id).order('full_name'),
      ])

      setMe(myProfile)
      setProfiles(allProfiles || [])

      // Get unread counts
      const { data: unread } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('receiver_id', user.id)
        .is('read_at', null)

      const counts: Record<string, number> = {}
      for (const m of unread || []) {
        counts[m.sender_id] = (counts[m.sender_id] || 0) + 1
      }
      setUnreadCounts(counts)
    }
    init()
  }, [])

  // Load messages for selected conversation
  const loadMessages = useCallback(async (otherId: string) => {
    if (!me) return
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${me.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${me.id})`)
      .order('created_at', { ascending: true })

    setMessages(data || [])

    // Mark incoming as read
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', otherId)
      .eq('receiver_id', me.id)
      .is('read_at', null)

    setUnreadCounts(prev => ({ ...prev, [otherId]: 0 }))
  }, [me])

  useEffect(() => {
    if (selectedId && me) {
      loadMessages(selectedId)
    }
  }, [selectedId, me, loadMessages])

  // Real-time subscription
  useEffect(() => {
    if (!me) return

    const channel = supabase
      .channel('messages-rt')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const msg = payload.new as Message
        const isForMe = msg.receiver_id === me.id || msg.sender_id === me.id
        if (!isForMe) return

        const otherId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id

        if (selectedId === otherId) {
          setMessages(prev => [...prev, msg])
          // Mark as read immediately since we're in this conversation
          if (msg.receiver_id === me.id) {
            supabase.from('messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', msg.id)
          }
        } else if (msg.receiver_id === me.id) {
          setUnreadCounts(prev => ({ ...prev, [otherId]: (prev[otherId] || 0) + 1 }))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [me, selectedId])

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!text.trim() || !me || !selectedId || sending) return
    setSending(true)
    const content = text.trim()
    setText('')

    await supabase.from('messages').insert({
      sender_id: me.id,
      receiver_id: selectedId,
      content,
    })
    setSending(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }

  function getInitials(name: string) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  const selectedProfile = profiles.find(p => p.id === selectedId)
  const filteredProfiles = profiles.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-canvas)' }}>
      {/* Contacts panel */}
      <div style={{
        width: '280px',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)', marginBottom: '12px' }}>הודעות</h2>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-4)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש..."
              style={{
                width: '100%', padding: '7px 32px 7px 10px',
                border: '1.5px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px', background: 'var(--bg-sunken)',
                color: 'var(--fg-1)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Contacts list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredProfiles.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--fg-4)', fontSize: '13px' }}>
              לא נמצאו נציגים
            </div>
          ) : filteredProfiles.map(p => {
            const isSelected = p.id === selectedId
            const unread = unreadCounts[p.id] || 0
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
                  background: isSelected ? 'var(--bg-sunken)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  textAlign: 'right', fontFamily: 'inherit',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{
                  width: '38px', height: '38px', borderRadius: '50%',
                  background: isSelected ? 'var(--brand)' : 'var(--brand-sky-100)',
                  color: isSelected ? 'white' : 'var(--brand-sky-700)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '13px', flexShrink: 0,
                }}>
                  {getInitials(p.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--fg-1)', marginBottom: '1px' }}>{p.full_name}</p>
                  <p style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
                    {p.role === 'admin' ? 'מנהל' : 'נציג מכירות'}
                  </p>
                </div>
                {unread > 0 && (
                  <div style={{
                    background: 'var(--brand)', color: 'white',
                    borderRadius: '99px', minWidth: '20px', height: '20px',
                    padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700, flexShrink: 0,
                  }}>
                    {unread}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedId ? (
          /* Empty state */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', color: 'var(--fg-4)' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquare size={28} style={{ color: 'var(--fg-4)' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '4px' }}>בחר נציג להתחלת שיחה</p>
              <p style={{ fontSize: '13px', color: 'var(--fg-4)' }}>הודעות פנימיות בין אנשי הצוות</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'var(--brand)', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '14px', flexShrink: 0,
              }}>
                {selectedProfile ? getInitials(selectedProfile.full_name) : '?'}
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: '14px', color: 'var(--fg-1)' }}>{selectedProfile?.full_name}</p>
                <p style={{ fontSize: '12px', color: 'var(--fg-4)' }}>
                  {selectedProfile?.role === 'admin' ? 'מנהל' : 'נציג מכירות'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--fg-4)', fontSize: '13px', marginTop: '40px' }}>
                  אין הודעות עדיין. שלח הודעה ראשונה!
                </div>
              )}
              {messages.map((msg, i) => {
                const isMine = msg.sender_id === me?.id
                const showTime = i === 0 || (new Date(msg.created_at).getTime() - new Date(messages[i - 1].created_at).getTime()) > 5 * 60 * 1000

                return (
                  <div key={msg.id}>
                    {showTime && (
                      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--fg-4)', background: 'var(--bg-sunken)', padding: '2px 10px', borderRadius: '99px' }}>
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-start' : 'flex-end' }}>
                      <div style={{
                        maxWidth: '65%',
                        padding: '10px 14px',
                        borderRadius: isMine ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
                        background: isMine ? 'var(--brand)' : 'var(--bg-surface)',
                        color: isMine ? 'white' : 'var(--fg-1)',
                        fontSize: '14px',
                        lineHeight: 1.5,
                        border: isMine ? 'none' : '1px solid var(--border-subtle)',
                        boxShadow: 'var(--shadow-sm)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              display: 'flex', gap: '10px', alignItems: 'flex-end',
            }}>
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="כתוב הודעה... (Enter לשליחה, Shift+Enter לשורה חדשה)"
                rows={1}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  border: '1.5px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  background: 'var(--bg-sunken)',
                  color: 'var(--fg-1)',
                  outline: 'none',
                  resize: 'none',
                  lineHeight: 1.5,
                  maxHeight: '120px',
                  overflowY: 'auto',
                  transition: 'border-color 140ms',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--brand)'; e.target.style.background = 'var(--bg-surface)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border-default)'; e.target.style.background = 'var(--bg-sunken)' }}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'
                  t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!text.trim() || sending}
                style={{
                  width: '42px', height: '42px', borderRadius: '50%',
                  background: text.trim() ? 'var(--brand)' : 'var(--bg-sunken)',
                  border: 'none', cursor: text.trim() ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 140ms',
                  boxShadow: text.trim() ? '0 2px 8px rgba(63,169,220,0.4)' : 'none',
                }}
              >
                <Send size={16} style={{ color: text.trim() ? 'white' : 'var(--fg-4)', transform: 'scaleX(-1)' }} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
