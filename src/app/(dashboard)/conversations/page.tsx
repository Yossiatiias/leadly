'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  sender_type: 'contact' | 'ai' | 'human'
  created_at: string
}

interface MessageFile {
  message_id: string
  file_url: string
  file_name: string
  file_type: string
}

interface Conversation {
  id: string
  contact_phone: string
  contact_name: string | null
  status: string
  bot_enabled: boolean
  updated_at: string
  lead_id?: string | null
  lead_status?: string | null
  unread_count?: number
  escalated_at?: string | null
  escalation_reason?: string | null
  awaitingReply?: boolean
  last_opened_at?: string | null
  last_activity_at?: string
}

export default function ConversationsPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const autoLeadId = searchParams.get('lead_id')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const autoOpenedRef = useRef(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageFiles, setMessageFiles] = useState<Record<string, MessageFile>>({})
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [stuckIds, setStuckIds] = useState<Set<string>>(new Set())
  const [waBlocked, setWaBlocked] = useState(false)
  const [waQualityWarning, setWaQualityWarning] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [greenToken, setGreenToken] = useState<string | null>(null)
  const [greenUrl, setGreenUrl] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedConvIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Polling: רענון הודעות + סטטוס לידים כל 5 שניות ────────────────────────
  useEffect(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    if (!selectedConvIdRef.current) return

    pollIntervalRef.current = setInterval(async () => {
      const convId = selectedConvIdRef.current
      if (!convId) return

      // רענון הודעות
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true })
      if (data) {
        setMessages(prev => {
          const dbIds = new Set(data.map((m: Message) => m.id))
          const temps = prev.filter(m => m.id.startsWith('temp-'))
          const merged = [...data, ...temps.filter(t => !data.some((d: Message) => d.content === t.content))]
          if (merged.length === prev.filter(m => !m.id.startsWith('temp-')).length + temps.length && dbIds.size === prev.filter(m => !m.id.startsWith('temp-')).length) return prev
          return merged
        })
      }

      // רענון סטטוס לידים בשיחות
      setConversations(prev => {
        const leadIds = prev.map(c => c.lead_id).filter(Boolean) as string[]
        if (leadIds.length === 0) return prev
        supabase.from('leads').select('id, status').in('id', leadIds).then(({ data: leadsData }) => {
          if (!leadsData) return
          const map: Record<string, string> = {}
          leadsData.forEach((l: any) => { map[l.id] = l.status })
          setConversations(cs => cs.map(c => c.lead_id && map[c.lead_id] ? { ...c, lead_status: map[c.lead_id] } : c))
        })
        return prev
      })
    }, 5000)

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [selected])

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
      .select('business_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.business_id) { setLoading(false); return }
    setBusinessId(profile.business_id)
    // אזהרות תשתית WhatsApp (כרטיס צהוב/הודעה תקועה) מיועדות ליוסי בלבד —
    // הצגתן לצוות המרפאה מלחיצה ופוגעת באמינות המערכת בעיניהם, בלי שהן
    // יכולות לעשות משהו עם המידע הזה בכל מקרה
    setIsSuperAdmin(profile.role === 'superadmin')

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
    // בכוונה בלי .order('updated_at') — updated_at מתעדכן ע"י טריגר בכל
    // UPDATE לשורה, כולל הכתיבה הפנימית של last_opened_at (סימון "נקרא").
    // מיון SQL לפי updated_at היה גורם לשיחה לקפוץ לראש הרשימה ברגע
    // שפותחים אותה, למרות שלא הייתה שום פעילות אמיתית (יוסי, 25/08). הסדר
    // האמיתי נקבע בהמשך הפונקציה לפי last_activity_at (זמן ההודעה
    // האחרונה בפועל) — לא לפי עמודה שמזוהמת ע"י כתיבות טכניות
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('business_id', bId)

    if (error) { console.error('conversations load error:', error); setLoading(false); return }

    const convs = data || []

    // Get lead statuses separately (safe — no FK required)
    const leadIds = convs.map((c: any) => c.lead_id).filter(Boolean) as string[]
    let leadStatusMap: Record<string, string> = {}
    if (leadIds.length > 0) {
      const { data: leadsData } = await supabase.from('leads').select('id, status').in('id', leadIds)
      ;(leadsData || []).forEach((l: any) => { leadStatusMap[l.id] = l.status })
    }

    // שיחות "ממתין לנציג" — כל שיחה שהבוט כבוי בה, לא רק אלה שהבוט עצמו
    // העביר (escalated_at). בפועל רוב הכיבוי כאן ידני (מתג בוט בשיחה עצמה),
    // לא ESCALATE של הבוט — ולכן escalated_at נשאר null ברוב המקרים,
    // וגרסה קודמת שהסתמכה רק עליו פספסה כמעט את כל השיחות הידניות בפועל
    // (נבדק על שיחת בדיקה אמיתית: bot_enabled=false, escalated_at=null)
    const manualIds = convs.filter((c: any) => !c.bot_enabled).map((c: any) => c.id)
    const awaitingReplySet = new Set<string>()

    // זמן ההודעה האחרונה בפועל בכל שיחה — לצורך "הדגשה" (ראה למטה),
    // נשלף לכל השיחות (לא רק ה"ידניות") כי גם ההדגשה זקוקה לזה
    const allIds = convs.map((c: any) => c.id)
    const lastMsgAtByConv: Record<string, string> = {}
    if (allIds.length > 0) {
      const { data: lastMsgs } = await supabase.from('messages')
        .select('conversation_id, direction, created_at')
        .in('conversation_id', allIds)
        .order('created_at', { ascending: false })
      const lastByConv: Record<string, { direction: string; created_at: string }> = {}
      for (const m of (lastMsgs || []) as { conversation_id: string; direction: string; created_at: string }[]) {
        if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m
      }
      for (const [id, last] of Object.entries(lastByConv)) lastMsgAtByConv[id] = last.created_at
      // "ממתין למענה" = ההודעה האחרונה בשיחה היא מהלקוח (עדיין לא ענה אף אחד
      // מאז) — לא תלוי ב-escalated_at שלרוב לא קיים
      for (const id of manualIds) {
        const last = lastByConv[id]
        if (last && last.direction === 'inbound') awaitingReplySet.add(id)
      }
    }

    const mapped = convs.map((c: any) => ({
      ...c,
      lead_status: c.lead_id ? (leadStatusMap[c.lead_id] ?? c.lead_status ?? null) : (c.lead_status ?? null),
      awaitingReply: awaitingReplySet.has(c.id),
      // עדיפות להודעה האמיתית האחרונה על פני updated_at הכללי של השיחה —
      // updated_at מתעדכן ע"י טריגר על **כל** שינוי בשורה (כולל last_opened_at
      // עצמו!), אז שימוש בו כאן היה גורם להדגשה שלא נעלמת אף פעם (נבדק
      // בפועל: כתיבת last_opened_at הזיזה גם את updated_at, אז ההשוואה
      // "last_opened_at >= updated_at" נכשלה תמיד). זמן ההודעה האחרונה הוא
      // האות האמיתי היחיד ל"יש התכתבות חדשה" (יוסי, 25/08)
      last_activity_at: lastMsgAtByConv[c.id] || c.updated_at,
    }))
    // מיון לפי פעילות אמיתית אחרונה בלבד — לא לפי updated_at (ראה הערה
    // למעלה). כך שסימון "נקרא" (last_opened_at) לעולם לא משפיע על המיקום
    // ברשימה, רק על ההדגשה. שיחות שכבר "קפצו" בגלל הבאג הקודם חוזרות
    // אוטומטית למקום הנכון בטעינה הבאה — אין צורך בתיקון נתונים ב-DB
    mapped.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''))
    setConversations(mapped)
    setLoading(false)

    // Auto-open conversation for a specific lead (when navigating from lead card)
    if (autoLeadId && !autoOpenedRef.current) {
      const match = mapped.find((c: any) => c.lead_id === autoLeadId)
      if (match) {
        autoOpenedRef.current = true
        openConversation(match)
      }
    }
  }

  // ─── פילטור שיחות לפי חיפוש + תאריכים ───────────────────────────────────
  const filteredConversations = conversations.filter(conv => {
    const q = search.toLowerCase()
    if (q && !((conv.contact_name || '').toLowerCase().includes(q)) && !conv.contact_phone.includes(q)) return false
    const activityAt = conv.last_activity_at || conv.updated_at
    if (dateFrom && activityAt < dateFrom) return false
    if (dateTo && activityAt > dateTo + 'T23:59:59') return false
    return true
  })

  async function openConversation(conv: Conversation) {
    setSelected(conv)
    selectedConvIdRef.current = conv.id
    setMessages([])
    setMessageFiles({})
    setStuckIds(new Set())

    // שם השיחה מודגש ברשימה כשיש בה פעילות מאז שהיא נפתחה לאחרונה — לכן
    // מעדכנים את last_opened_at בכל פתיחה (לא רק בפעם הראשונה), כדי שאם
    // מגיעה הודעה חדשה אחרי הפתיחה, השיחה תודגש שוב (יוסי, 25/08: "אחרי
    // שפתחנו שיחה אין צורך שהיא תהיה מודגשת שוב אלא אם כן הייתה התכתבות
    // נוספת").
    //
    // קרה בפועל (25/08): הקריאה הזו הייתה fire-and-forget — לא ממתינים
    // לתשובה ולא בודקים שגיאה — וה-state המקומי תמיד התעדכן ל"נקרא" בלי
    // תלות אם הכתיבה ל-DB באמת הצליחה. התוצאה: השיחה נראתה לא-מודגשת מיד
    // (state אופטימי), אבל אם הכתיבה נכשלה בשקט (כל סיבה — כולל race עם
    // הריענון של ה-realtime subscription), אחרי Refresh היא חזרה להיות
    // מודגשת כי בפועל שום דבר לא נשמר. בדקתי ישירות מול ה-DB: 0 שיחות
    // אמיתיות (לא מסקריפט בדיקה) קיבלו last_opened_at אחרי שיחות פתיחה
    // בפועל — בדיוק התבנית "לפעמים נשאר, לפעמים חוזר" שדווחה. עכשיו
    // ממתינים לתשובה בפועל ומעדכנים את ה-state המקומי רק אחרי אישור
    // מה-DB עצמו — לא לפני
    const openedAt = new Date().toISOString()
    const { data: updated, error: openErr } = await supabase
      .from('conversations')
      .update({ last_opened_at: openedAt })
      .eq('id', conv.id)
      .select('last_opened_at')
      .single()
    if (openErr) {
      console.error('[conversations] failed to persist last_opened_at — conversation will still show as unread after refresh:', JSON.stringify({ conversationId: conv.id, error: openErr }))
    } else {
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, last_opened_at: updated?.last_opened_at || openedAt } : c))
    }

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })

    setMessages(data || [])
    checkDelivery(conv.id)

    const msgIds = (data || []).map((m: Message) => m.id)
    if (msgIds.length > 0) {
      const { data: files } = await supabase
        .from('lead_files')
        .select('message_id, file_url, file_name, file_type')
        .in('message_id', msgIds)
      if (files) {
        const map: Record<string, MessageFile> = {}
        for (const f of files) if (f.message_id) map[f.message_id] = f
        setMessageFiles(map)
      }
    }
  }

  /* בודק אילו הודעות תקועות ולא נמסרו ללקוח בפועל — רק ליוסי (superadmin).
     צוות המרפאה לא רואה את זה, ולכן גם אין טעם להטריח את Green API בשבילם. */
  async function checkDelivery(convId?: string) {
    if (!isSuperAdmin) return
    const id = convId || selectedConvIdRef.current
    if (!id || !businessId) return
    try {
      const res = await fetch('/api/whatsapp/delivery-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: id, business_id: businessId }),
      })
      const data = await res.json()
      if (selectedConvIdRef.current !== id) return // הוחלפה שיחה בינתיים
      setStuckIds(new Set(data.stuckIds || []))
      setWaBlocked(!!data.blocked)
      setWaQualityWarning(!!data.qualityWarning)
    } catch { /* בדיקה כושלת לא אמורה לשבור את המסך */ }
  }

  // בדיקה תקופתית — הודעה עשויה להשתחרר או להיתקע אחרי זמן (superadmin בלבד)
  useEffect(() => {
    if (!selected || !businessId || !isSuperAdmin) return
    const t = setInterval(() => checkDelivery(), 30_000)
    return () => clearInterval(t)
  }, [selected?.id, businessId, isSuperAdmin])

  async function toggleBot(conv: Conversation) {
    const newVal = !conv.bot_enabled
    // הפעלה מחדש של הסוכן = הנציג טיפל בבקשה — מנקים גם את סטטוס "ממתין
    // לנציג" (status חוזר ל-active), אחרת webhook.ts ימשיך לחסום את הבוט
    // בגלל status==='human_takeover' גם אם bot_enabled חזר ל-true
    const extra = newVal ? { status: 'active', escalated_at: null, escalation_reason: null } : {}
    await supabase.from('conversations').update({ bot_enabled: newVal, ...extra }).eq('id', conv.id)
    setSelected(s => s ? { ...s, bot_enabled: newVal, ...extra } : s)
    setConversations(cs => cs.map(c => c.id === conv.id ? { ...c, bot_enabled: newVal, ...extra } : c))
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

    // שליחה דרך השרת — ההודעה נשמרת רק אם Green API אישר
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selected.id,
          business_id: businessId,
          message: text,
        }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        // כשל — הסר את ההודעה מהמסך, החזר את הטקסט לתיבה והצג שגיאה
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setDraft(text)
        alert('ההודעה לא נשלחה: ' + (data.error || 'שגיאה לא ידועה'))
      } else if (data.message) {
        // התקבל אצל WhatsApp — החלף את ההודעה הזמנית בזו שנשמרה במסד
        setMessages(prev => prev.map(m => m.id === tempId ? data.message : m))
        // השרת בדק אם ההודעה נתקעה בתור ולא נמסרה בפועל
        if (data.delivered === false) {
          setStuckIds(prev => new Set(prev).add(data.message.id))
          setWaBlocked(true)
        }
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setDraft(text)
      alert('ההודעה לא נשלחה — בעיית תקשורת')
    }

    setSending(false)
  }

  // שליחת קובץ ידנית — מעלה קודם ל-Storage (אותו bucket שכבר משמש לקבצים
  // נכנסים), ואז מבקש מהשרת לשלוח את ה-URL הציבורי דרך Green API. השרת
  // רק אחרי אישור מ-WhatsApp שומר את ההודעה + רשומת הקובץ במסד
  async function sendFile(file: File) {
    if (!selected || !businessId || !selected.lead_id) {
      alert('לא ניתן לצרף קובץ לשיחה הזו (לא נמצא ליד משויך)')
      return
    }
    // גודל מקסימלי — כדי שהשליחה תישאר מהירה ותעבור בוואטסאפ בלי בעיות
    if (file.size > 15 * 1024 * 1024) {
      alert('הקובץ גדול מדי (מקסימום 15MB)')
      return
    }
    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${selected.lead_id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('lead-files').upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('lead-files').getPublicUrl(path)

      const res = await fetch('/api/whatsapp/send-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selected.id,
          business_id: businessId,
          lead_id: selected.lead_id,
          file_url: publicUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        alert('הקובץ לא נשלח: ' + (data.error || 'שגיאה לא ידועה'))
        return
      }
      if (data.message) setMessages(prev => [...prev, data.message])
      if (data.file) setMessageFiles(prev => ({ ...prev, [data.message.id]: data.file }))
    } catch {
      alert('הקובץ לא נשלח — שגיאה בהעלאה')
    } finally {
      setUploadingFile(false)
    }
  }

  // שעה לכל בועת הודעה בתוך שיחה פתוחה — תמיד HH:MM, לא שונה כאן
  // (זה לא היה חלק מהבקשה, ונשאר בדיוק כמו שהיה)
  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  // תאריך/שעה ברשימת השיחות — כמו בווטסאפ: היום → שעה, אתמול → "אתמול",
  // השבוע האחרון → שם יום, מעבר לזה → תאריך. משווה לפי תחילת יום קלנדרי
  // (לא חלון של 24 שעות מתגלגל), כדי ש"אתמול" יישאר "אתמול" גם ב-23:59
  function formatConvListTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'אתמול'
    if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('he-IL', { weekday: 'long' })
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#5B8FA8' }}>טוען...</div>

  return (
    <div className="mobile-full-height" style={{ display: 'flex', direction: 'rtl', overflow: 'hidden' }}>

      {/* Conversation list — במובייל תופס את כל המסך, ונעלם ברגע שנבחרה שיחה */}
      <div className={`conv-list-pane${selected ? ' mobile-hidden' : ''}`} style={{
        width: '320px', flexShrink: 0,
        borderLeft: '1px solid var(--border-default)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>שיחות</h2>
            <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>{filteredConversations.length} שיחות</span>
          </div>
          {/* חיפוש */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 חיפוש לפי שם או טלפון..."
            style={{
              width: '100%', padding: '7px 10px', borderRadius: '8px', fontSize: '12px',
              border: '1px solid var(--border-default)', background: 'var(--bg-sunken)',
              color: 'var(--fg-1)', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {/* סינון תאריכים */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ flex: 1, padding: '5px 6px', borderRadius: '7px', fontSize: '11px', border: '1px solid var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none' }} />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ flex: 1, padding: '5px 6px', borderRadius: '7px', fontSize: '11px', border: '1px solid var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-1)', outline: 'none' }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredConversations.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: '32px', margin: '0 0 8px' }}>💬</p>
              <p style={{ color: '#7AAEC4', fontSize: '13px' }}>אין שיחות</p>
            </div>
          ) : (
            filteredConversations.map(conv => {
              // "לא נפתחה" — אותו תנאי בדיוק שכבר קבע את ה-font-weight, רק
              // ממוצה פעם אחת כדי שגם הרקע וגם הנקודה ישתמשו באותה הגדרה.
              // לוגיקה לא השתנתה, רק חשיפה ויזואלית נוספת (נקודה + גוון רקע)
              // כדי שהעין תתפוס את זה גם בסריקה מהירה, לא רק בעובי הטקסט
              const isUnread = !(conv.last_opened_at && new Date(conv.last_opened_at) >= new Date(conv.last_activity_at || conv.updated_at))
              const isSelected = selected?.id === conv.id
              return (
              <div
                key={conv.id}
                onClick={() => openConversation(conv)}
                style={{
                  padding: '14px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: isSelected ? 'var(--bg-hover)' : isUnread ? 'var(--brand-soft)' : 'var(--bg-surface)',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <p style={{ fontWeight: isUnread ? 700 : 400, color: 'var(--fg-1)', fontSize: '14px', margin: 0, whiteSpace: 'nowrap' }}>
                          {conv.contact_name || conv.contact_phone}
                        </p>
                        {conv.escalated_at && (
                          <span title={conv.escalation_reason || 'הבוט סימן שדרוש מעקב אנושי'} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 500 }}>
                            ממתין לנציג
                          </span>
                        )}
                      </div>
                      {conv.contact_name && (
                        <p style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '1px 0 0' }}>{conv.contact_phone}</p>
                      )}
                      {/* "מחכה לתשובה" — מוצג רק כשבאמת יש הודעה שממתינה במצב
                          ידני. "ממתין לנציג" עבר להיות ליד השם (למעלה) */}
                      {(conv.awaitingReply || conv.lead_status === 'published') && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                          {conv.awaitingReply && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', padding: '2px 7px', borderRadius: '99px', background: 'var(--danger-soft)', color: 'var(--danger)', fontWeight: 500 }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                              מחכה לתשובה
                            </span>
                          )}
                          {conv.lead_status === 'published' && (
                            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '99px', background: 'var(--success-soft)', color: 'var(--success)', fontWeight: 500 }}>✓ תור</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {isUnread && (
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--brand)', flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: '10px', color: isUnread ? 'var(--brand)' : 'var(--fg-3)', fontWeight: isUnread ? 600 : 400 }}>{formatConvListTime(conv.last_activity_at || conv.updated_at)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {conv.bot_enabled ? (
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '99px', background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-border)' }}>
                          🤖 בוט
                        </span>
                      ) : (
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '99px', background: 'var(--warning-soft)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }}>
                          👤 ידני
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              )
            })
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
              {/* חזרה לרשימת השיחות — מוצג רק במובייל */}
              <button
                onClick={() => setSelected(null)}
                className="mobile-only"
                aria-label="חזרה לרשימת השיחות"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--fg-2)', fontSize: '20px', padding: '4px',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                →
              </button>
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
                {selected.bot_enabled ? 'הסוכן מגיב אוטומטית' : 'מצב ידני'}
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
                {selected.bot_enabled ? '⏸ עצור סוכן' : '▶ הפעל סוכן'}
              </button>
            </div>
          </div>

          {/* אזהרות תשתית WhatsApp — ליוסי (superadmin) בלבד. צוות המרפאה לא רואה
              אותן: זה מלחיץ ופוגע באמינות המערכת בעיניהם, בלי שהם יכולים לפעול לפיהן. */}
          {/* אזהרה אדומה: יש עדות אמיתית שהודעות תקועות ולא נמסרות (לא רק דגל) */}
          {isSuperAdmin && waBlocked && (
            <div style={{
              padding: '10px 20px', background: '#FEF2F2', borderBottom: '1px solid #FCA5A5',
              display: 'flex', alignItems: 'center', gap: '9px',
            }}>
              <span style={{ fontSize: '15px' }}>⚠️</span>
              <div>
                <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#B91C1C' }}>
                  WhatsApp הגבילה את המספר — יש הודעות יוצאות שלא נמסרות כרגע
                </p>
                <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#B91C1C', opacity: 0.85 }}>
                  הודעות תקועות מסומנות באדום. עדיף להמתין ולא לשלוח עד שהתור מתפנה.
                </p>
              </div>
            </div>
          )}

          {/* אזהרה צהובה עדינה יותר: WhatsApp סימנה את החשבון לבדיקת איכות,
              אבל אין כרגע עדות שהודעות בפועל לא נמסרות (התור ריק) */}
          {isSuperAdmin && !waBlocked && waQualityWarning && (
            <div style={{
              padding: '9px 20px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A',
              display: 'flex', alignItems: 'center', gap: '9px',
            }}>
              <span style={{ fontSize: '14px' }}>🟡</span>
              <p style={{ margin: 0, fontSize: '11.5px', color: '#92400E' }}>
                WhatsApp מסמנת את המספר לבדיקת איכות — הודעות כרגע כן יוצאות, אך מומלץ להימנע משליחה מרובה ברצף
              </p>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#7AAEC4', fontSize: '13px' }}>
                אין הודעות בשיחה זו
              </div>
            )}
            {messages.map(msg => {
              // הודעה יוצאת שנתקעה ולא הגיעה ללקוח — מסומנת באדום, ליוסי בלבד
              const notDelivered = isSuperAdmin && msg.direction === 'outbound' && stuckIds.has(msg.id)
              return (
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
                    : notDelivered ? '#FEF2F2'
                    : msg.sender_type === 'ai' ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  border: notDelivered ? '1.5px solid #F87171'
                    : msg.sender_type === 'human' ? '1px solid var(--border-default)' : 'none',
                }}>
                  {msg.sender_type !== 'contact' && (
                    <p style={{ fontSize: '10px', color: msg.direction === 'inbound' ? '#2d6a2d' : 'var(--fg-3)', margin: '0 0 4px', fontWeight: 600 }}>
                      {msg.sender_type === 'ai' ? '🤖 סוכן AI' : '👤 נציג'}
                    </p>
                  )}
                  {messageFiles[msg.id] && (
                    messageFiles[msg.id].file_type?.startsWith('image/') ? (
                      <a href={messageFiles[msg.id].file_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={messageFiles[msg.id].file_url}
                          alt={messageFiles[msg.id].file_name}
                          style={{ maxWidth: '220px', maxHeight: '220px', borderRadius: '10px', display: 'block', marginBottom: '6px', cursor: 'pointer' }}
                        />
                      </a>
                    ) : (
                      <a
                        href={messageFiles[msg.id].file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px',
                          background: 'rgba(0,0,0,0.05)', borderRadius: '8px', marginBottom: '6px',
                          fontSize: '12.5px', color: 'inherit', textDecoration: 'none',
                        }}
                      >
                        📎 {messageFiles[msg.id].file_name}
                      </a>
                    )
                  )}
                  <p style={{ margin: 0, fontSize: '14px', color: msg.direction === 'inbound' ? '#1a1a1a' : 'var(--fg-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '4px' }}>
                    {notDelivered ? (
                      <span style={{ fontSize: '10px', color: '#DC2626', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                        ⚠️ לא נמסרה ללקוח
                      </span>
                    ) : <span />}
                    <span style={{ fontSize: '10px', color: msg.direction === 'inbound' ? '#4a7a4a' : 'var(--fg-3)' }}>
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                </div>
              </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input — פעיל רק במצב ידני. כשהסוכן מגיב, כתיבה ידנית חסומה
              כדי שהנציג והבוט לא יענו במקביל לאותו לקוח. */}
          {selected.bot_enabled ? (
            <div style={{
              padding: '16px 20px', background: 'var(--bg-sunken)', borderTop: '1px solid var(--border-default)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🤖</span>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--fg-2)' }}>
                    הסוכן מנהל את השיחה
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--fg-4)' }}>
                    כדי לכתוב בעצמך — עצור את הסוכן תחילה
                  </p>
                </div>
              </div>
              <button
                onClick={() => toggleBot(selected)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '9px 18px', borderRadius: '10px', border: '1px solid #FCA5A5',
                  background: '#FEF2F2', color: '#C0392B',
                  fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                }}
              >
                ⏸ עצור סוכן וכתוב ידנית
              </button>
            </div>
          ) : (
            <div style={{
              padding: '14px 20px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border-default)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px',
                fontSize: '11px', fontWeight: 600, color: '#2E7D32',
              }}>
                ✍️ מצב ידני — ההודעות נשלחות ממך, הסוכן מושהה
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
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
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  title="צרף קובץ"
                  style={{
                    padding: '10px 14px', borderRadius: '10px',
                    border: '1px solid var(--border-default)', background: 'var(--bg-sunken)',
                    color: 'var(--fg-2)', cursor: uploadingFile ? 'default' : 'pointer',
                    fontSize: '16px', fontFamily: 'inherit', opacity: uploadingFile ? 0.6 : 1,
                  }}
                >
                  {uploadingFile ? '…' : '📎'}
                </button>
                <button
                  onClick={sendMessage}
                  disabled={sending || !draft.trim()}
                  style={{
                    padding: '10px 20px', borderRadius: '10px', border: 'none',
                    cursor: sending || !draft.trim() ? 'default' : 'pointer',
                    background: sending || !draft.trim() ? 'var(--border-default)' : 'var(--brand)',
                    color: sending || !draft.trim() ? 'var(--fg-3)' : 'white',
                    fontWeight: 600, fontSize: '14px', fontFamily: 'inherit',
                  }}
                >
                  {sending ? '...' : 'שלח'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // במובייל אין טעם ב"בחר שיחה" — הרשימה כבר תופסת את כל המסך
        <div className="conv-chat-pane mobile-hidden" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-canvas)' }}>
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
