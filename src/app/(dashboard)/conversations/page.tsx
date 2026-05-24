'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  sender_type: 'contact' | 'ai' | 'human'
  created_at: string
}

interface Conversation {
  id: string
  contact_phone: string
  contact_name: string | null
  status: string
  bot_enabled: boolean
  updated_at: string
  unread_count?: number
}

export default function ConversationsPage() {
  const supabase = createClient()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [greenToken, setGreenToken] = useState<string | null>(null)
  const [greenUrl, setGreenUrl] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedConvIdRef = useRef<string | null>(null)

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.business_id) return
    setBusinessId(profile.business_id)

    // Load WhatsApp connection for sending
    const { data: conn } = await supabase
      .from('whatsapp_connections')
      .select('instance_id, api_token, api_url')
      .eq('business_id', profile.business_id)
      .single()

    if (conn) {
      setInstanceId(conn.instance_id)
      setGreenToken(conn.api_token)
      setGreenUrl(conn.api_url || process.env.NEXT_PUBLIC_GREEN_API_URL || 'https://7107.api.greenapi.com')
    }

    await loadConversations(profile.business_id)

    // Realtime subscription
    const ch = supabase.channel('conversations-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${profile.business_id}` }, () => {
        loadConversations(profile.business_id)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `business_id=eq.${profile.business_id}` }, (payload) => {
        const msg = payload.new as Message & { conversation_id: string }
        // Only add to view if it belongs to the currently open conversation
        if (msg.conversation_id === selectedConvIdRef.current) {
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id || (m.id.startsWith('temp-') && m.content === msg.content))) return prev
            return [...prev, msg]
          })
        }
        loadConversations(profile.business_id)
      })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }

  async function loadConversations(bId: string) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('business_id', bId)
      .order('updated_at', { ascending: false })

    setConversations(data || [])
    setLoading(false)
  }

  async function openConversation(conv: Conversation) {
    setSelected(conv)
    selectedConvIdRef.current = conv.id
    setMessages([])

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })

    setMessages(data || [])
  }

  async function toggleBot(conv: Conversation) {
    const newVal = !conv.bot_enabled
    await supabase.from('conversations').update({ bot_enabled: newVal }).eq('id', conv.id)
    setSelected(s => s ? { ...s, bot_enabled: newVal } : s)
    setConversations(cs => cs.map(c => c.id === conv.id ? { ...c, bot_enabled: newVal } : c))
  }

  async function sendMessage() {
    if (!draft.trim() || !selected || !businessId) return
    setSending(true)

    const text = draft.trim()
    setDraft('')

    // Optimistic update — show immediately without waiting for Realtime
    const tempId = `temp-${Date.now()}`
    const tempMsg: Message = {
      id: tempId,
      direction: 'outbound',
      content: text,
      sender_type: 'human',
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])

    // Send via Green API
    if (instanceId && greenToken) {
      const url = greenUrl || 'https://7107.api.greenapi.com'
      await fetch(`${url}/waInstance${instanceId}/sendMessage/${greenToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${selected.contact_phone}@c.us`, message: text }),
      }).catch(() => {})
    }

    const { data: inserted } = await supabase.from('messages').insert({
      conversation_id: selected.id,
      business_id: businessId,
      direction: 'outbound',
      content: text,
      sender_type: 'human',
    }).select().single()

    // Replace temp message with real one from DB
    if (inserted) {
      setMessages(prev => prev.map(m => m.id === tempId ? inserted : m))
    }

    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', selected.id)

    setSending(false)
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#5B8FA8' }}>טוען...</div>

  return (
    <div style={{ display: 'flex', height: '100vh', direction: 'rtl', overflow: 'hidden' }}>

      {/* Conversation list */}
      <div style={{
        width: '320px', flexShrink: 0,
        borderLeft: '1px solid var(--border-default)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>שיחות</h2>
          <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '4px 0 0' }}>{conversations.length} שיחות</p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {conversations.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: '32px', margin: '0 0 8px' }}>💬</p>
              <p style={{ color: '#7AAEC4', fontSize: '13px' }}>אין שיחות עדיין</p>
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => openConversation(conv)}
                style={{
                  padding: '14px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: selected?.id === conv.id ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '50%',
                      background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '14px', fontWeight: 700, color: 'var(--fg-1)', flexShrink: 0,
                    }}>
                      {(conv.contact_name || conv.contact_phone)[0]}
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '14px', margin: 0 }}>
                        {conv.contact_name || conv.contact_phone}
                      </p>
                      {conv.contact_name && (
                        <p style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '1px 0 0' }}>{conv.contact_phone}</p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--fg-3)' }}>{formatTime(conv.updated_at)}</span>
                    <span style={{
                      fontSize: '10px', padding: '2px 6px', borderRadius: '99px',
                      background: conv.bot_enabled ? '#E8F8EC' : '#FEF2F2',
                      color: conv.bot_enabled ? '#2E7D32' : '#C0392B',
                    }}>
                      {conv.bot_enabled ? 'בוט פעיל' : 'אנושי'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat window */}
      {selected ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>

          {/* Chat header */}
          <div style={{
            padding: '14px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '50%',
                background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)',
              }}>
                {(selected.contact_name || selected.contact_phone)[0]}
              </div>
              <div>
                <p style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '15px', margin: 0 }}>
                  {selected.contact_name || selected.contact_phone}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '2px 0 0' }}>{selected.contact_phone}</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--fg-3)' }}>
                {selected.bot_enabled ? 'הבוט מגיב אוטומטית' : 'מצב ידני'}
              </span>
              <button
                onClick={() => toggleBot(selected)}
                style={{
                  padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: selected.bot_enabled ? '#FEF2F2' : '#E8F8EC',
                  color: selected.bot_enabled ? '#C0392B' : '#2E7D32',
                  fontFamily: 'inherit', fontWeight: 600, fontSize: '12px',
                }}
              >
                {selected.bot_enabled ? '⏸ עצור בוט' : '▶ הפעל בוט'}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#7AAEC4', fontSize: '13px' }}>
                אין הודעות בשיחה זו
              </div>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: msg.direction === 'inbound' ? 'flex-end' : 'flex-start',
                  marginBottom: '10px',
                }}
              >
                <div style={{
                  maxWidth: '65%',
                  padding: '10px 14px',
                  borderRadius: msg.direction === 'inbound'
                    ? '16px 16px 4px 16px'
                    : '16px 16px 16px 4px',
                  background: msg.direction === 'inbound'
                    ? '#DCF8C6'
                    : msg.sender_type === 'ai' ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  border: msg.sender_type === 'human' ? '1px solid var(--border-default)' : 'none',
                }}>
                  {msg.sender_type !== 'contact' && (
                    <p style={{ fontSize: '10px', color: 'var(--fg-3)', margin: '0 0 4px', fontWeight: 600 }}>
                      {msg.sender_type === 'ai' ? '🤖 AI' : '👤 נציג'}
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: '14px', color: 'var(--fg-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: '10px', color: 'var(--fg-3)', textAlign: 'left' }}>
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '14px 20px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-default)',
            display: 'flex', gap: '10px', alignItems: 'flex-end',
          }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="כתוב הודעה... (Enter לשליחה)"
              rows={2}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '10px',
                border: '1px solid var(--border-default)', fontSize: '14px', fontFamily: 'inherit',
                resize: 'none', outline: 'none', background: 'var(--bg-sunken)', color: 'var(--fg-1)',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !draft.trim()}
              style={{
                padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                background: sending || !draft.trim() ? '#A8D5EE' : '#3FA9DC',
                color: 'white', fontWeight: 600, fontSize: '14px', fontFamily: 'inherit',
              }}
            >
              {sending ? '...' : 'שלח'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-canvas)' }}>
          <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
            <p style={{ fontSize: '48px', margin: '0 0 12px' }}>💬</p>
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--fg-2)' }}>בחר שיחה</p>
            <p style={{ fontSize: '13px' }}>לחץ על שיחה מהרשימה כדי לצפות בה</p>
          </div>
        </div>
      )}
    </div>
  )
}
