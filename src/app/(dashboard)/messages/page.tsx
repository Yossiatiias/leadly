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
      const { data: unread } = await supabase.from('messages').select('sender_id').eq('receiver_id', user.id).is('read_at', null)
      const counts: Record<string, number> = {}
      for (const m of unread || []) counts[m.sender_id] = (counts[m.sender_id] || 0) + 1
      setUnreadCounts(counts)
    }
    init()
  }, [])

  const loadMessages = useCallback(async (otherId: string) => {
    if (!me) return
    const { data } = await supabase.from('messages').select('*')
      .or(`and(sender_id.eq.${me.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${me.id})`)
      .order('created_at', { ascending: true })
    setMessages(data || [])
    await supabase.from('messages').update({ read_at: new Date().toISOString() })
      .eq('sender_id', otherId).eq('receiver_id', me.id).is('read_at', null)
    setUnreadCounts(prev => ({ ...prev, [otherId]: 0 }))
  }, [me])

  useEffect(() => { if (selectedId && me) loadMessages(selectedId) }, [selectedId, me, loadMessages])

  useEffect(() => {
    if (!me) return
    const ch = supabase.channel('msg-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        if (msg.receiver_id !== me.id && msg.sender_id !== me.id) return
        const otherId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id
        if (selectedId === otherId) {
          setMessages(prev => [...prev, msg])
          if (msg.receiver_id === me.id) supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id)
        } else if (msg.receiver_id === me.id) {
          setUnreadCounts(prev => ({ ...prev, [otherId]: (prev[otherId] || 0) + 1 }))
        }
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me, selectedId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendMessage() {
    if (!text.trim() || !me || !selectedId || sending) return
    setSending(true)
    const content = text.trim()
    setText('')
    await supabase.from('messages').insert({ sender_id: me.id, receiver_id: selectedId, content })
    setSending(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const isToday = d.toDateString() === new Date().toDateString()
    if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }

  function getInitials(name: string) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }

  const selectedProfile = profiles.find(p => p.id === selectedId)
  const filteredProfiles = profiles.filter(p => p.full_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F9FAFB' }}>
      {/* Contacts */}
      <div style={{ width: '260px', flexShrink: 0, background: 'white', borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #E5E7EB' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 500, color: '#374151', marginBottom: '12px' }}>הודעות</h2>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש..."
              style={{ width: '100%', padding: '7px 30px 7px 10px', border: '1px solid #E5E7EB', borderRadius: '8px', fontSize: '13px', background: '#F9FAFB', color: '#374151', outline: 'none', fontFamily: 'inherit' }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredProfiles.map(p => {
            const isSelected = p.id === selectedId
            const unread = unreadCounts[p.id] || 0
            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)} style={{
                width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
                background: isSelected ? '#EBF5FA' : 'transparent',
                borderBottom: '1px solid #F3F4F6',
                display: 'flex', alignItems: 'center', gap: '10px',
                fontFamily: 'inherit', transition: 'background 0.1s',
              }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#F9FAFB' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: isSelected ? '#3FA9DC' : '#D6EDF8', color: isSelected ? 'white' : '#1A4F6E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '12px', flexShrink: 0 }}>
                  {getInitials(p.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                  <p style={{ fontWeight: 500, fontSize: '13px', color: '#374151' }}>{p.full_name}</p>
                  <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{p.role === 'admin' ? 'מנהל' : 'נציג מכירות'}</p>
                </div>
                {unread > 0 && (
                  <span style={{ background: '#3FA9DC', color: 'white', borderRadius: '99px', minWidth: '18px', height: '18px', padding: '0 5px', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedId ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: '#9CA3AF' }}>
            <MessageSquare size={32} style={{ color: '#D1D5DB' }} />
            <p style={{ fontSize: '14px', fontWeight: 500, color: '#6B7280' }}>בחר נציג להתחלת שיחה</p>
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #E5E7EB', background: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#3FA9DC', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '13px' }}>
                {selectedProfile ? getInitials(selectedProfile.full_name) : '?'}
              </div>
              <div>
                <p style={{ fontWeight: 500, fontSize: '14px', color: '#374151' }}>{selectedProfile?.full_name}</p>
                <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{selectedProfile?.role === 'admin' ? 'מנהל' : 'נציג מכירות'}</p>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {messages.length === 0 && (
                <p style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '13px', marginTop: '40px' }}>אין הודעות עדיין</p>
              )}
              {messages.map((msg, i) => {
                const isMine = msg.sender_id === me?.id
                const showTime = i === 0 || (new Date(msg.created_at).getTime() - new Date(messages[i - 1].created_at).getTime()) > 5 * 60 * 1000
                return (
                  <div key={msg.id}>
                    {showTime && (
                      <div style={{ textAlign: 'center', margin: '4px 0 8px' }}>
                        <span style={{ fontSize: '11px', color: '#9CA3AF', background: '#F3F4F6', padding: '2px 10px', borderRadius: '99px' }}>
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-start' : 'flex-end' }}>
                      <div style={{
                        maxWidth: '60%', padding: '9px 13px',
                        borderRadius: isMine ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
                        background: isMine ? '#3FA9DC' : 'white',
                        color: isMine ? 'white' : '#374151',
                        fontSize: '14px', lineHeight: 1.5,
                        border: isMine ? 'none' : '1px solid #E5E7EB',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #E5E7EB', background: 'white', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="כתוב הודעה... (Enter לשליחה)"
                rows={1}
                style={{ flex: 1, padding: '9px 13px', border: '1px solid #E5E7EB', borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', background: '#F9FAFB', color: '#374151', outline: 'none', resize: 'none', lineHeight: 1.5, maxHeight: '120px', overflowY: 'auto' }}
                onFocus={e => { e.target.style.borderColor = '#3FA9DC'; e.target.style.background = 'white' }}
                onBlur={e => { e.target.style.borderColor = '#E5E7EB'; e.target.style.background = '#F9FAFB' }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }}
              />
              <button onClick={sendMessage} disabled={!text.trim() || sending}
                style={{ width: '40px', height: '40px', borderRadius: '50%', background: text.trim() ? '#3FA9DC' : '#E5E7EB', border: 'none', cursor: text.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 140ms' }}>
                <Send size={15} style={{ color: text.trim() ? 'white' : '#9CA3AF', transform: 'scaleX(-1)' }} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
