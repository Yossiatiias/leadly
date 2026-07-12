'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Paperclip, Link2, MessageSquare, BookOpen, Trash2, Edit2,
  Plus, Send, Globe, Upload, Check, X, Bot, Users,
} from 'lucide-react'

interface KnowledgeItem {
  id: string
  type: 'qa' | 'file' | 'url'
  title: string
  question: string
  answer: string
  content?: string
  file_url?: string
  source_url?: string
  category: string
  audience: 'both' | 'customer' | 'staff'
  is_active: boolean
  created_at: string
}

interface ChatMsg { role: 'user' | 'assistant'; text: string }

const QA_CATEGORIES = ['כללי', 'שעות פעילות', 'מחירים', 'שירותים', 'צוות', 'מיקום והגעה', 'אחר']

// ─── Mode config ──────────────────────────────────────────────────────────────
const MODES = {
  customer: {
    key:         'customer',
    label:       'בוט וואטסאפ',
    sublabel:    'מידע שהלקוח מקבל מהבוט',
    icon:        Bot,
    color:       '#10B981',
    bg:          '#ECFDF5',
    border:      '#6EE7B7',
    chatTitle:   'שאל כבוט הלקוח',
    chatSub:     'בדוק מה הלקוח יקבל בתשובה',
    chatPlaceholder: 'שאל שאלה כמו לקוח: כמה עולה השתלה?',
    audienceFilter: (a: string) => a === 'customer' || a === 'both' || !a,
    audienceOptions: [
      { value: 'customer', label: 'לקוחות בלבד' },
      { value: 'both',     label: 'לקוחות + צוות' },
    ],
  },
  staff: {
    key:         'staff',
    label:       'צוות פנימי',
    sublabel:    'מידע שהנציג רואה בלבד',
    icon:        Users,
    color:       '#8B5CF6',
    bg:          '#F5F3FF',
    border:      '#C4B5FD',
    chatTitle:   'שאל כנציג',
    chatSub:     'בדוק מה הצוות יקבל בתשובה (כולל מידע פנימי)',
    chatPlaceholder: 'שאל שאלה פנימית: מה ההנחה המקסימלית?',
    audienceFilter: (a: string) => a === 'staff' || a === 'both' || !a,
    audienceOptions: [
      { value: 'staff', label: 'צוות בלבד' },
      { value: 'both',  label: 'לקוחות + צוות' },
    ],
  },
}

export default function KnowledgePage() {
  const supabase = createClient()
  const [mode, setMode]         = useState<'customer' | 'staff'>('customer')
  const [tab, setTab]           = useState<'qa' | 'files' | 'urls' | 'chat'>('qa')
  const [items, setItems]       = useState<KnowledgeItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [businessId, setBId]    = useState<string | null>(null)

  // Q&A form
  const [showQAForm, setShowQAForm] = useState(false)
  const [editId,     setEditId]     = useState<string | null>(null)
  const [qaForm, setQAForm] = useState({ question: '', answer: '', category: 'כללי', audience: 'customer' })
  const [savingQA, setSavingQA] = useState(false)

  // File upload
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileTitle,  setFileTitle]  = useState('')
  const [fileAud,    setFileAud]    = useState('customer')
  const [uploading,  setUploading]  = useState(false)
  const [uploadMsg,  setUploadMsg]  = useState('')

  // URL scrape
  const [urlInput,  setUrlInput]  = useState('')
  const [urlTitle,  setUrlTitle]  = useState('')
  const [urlAud,    setUrlAud]    = useState('customer')
  const [scraping,  setScraping]  = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')

  // Chat
  const [chatInput,   setChatInput]   = useState('')
  const [chatMsgs,    setChatMsgs]    = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadData() }, [])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])
  // Reset chat when switching mode
  useEffect(() => { setChatMsgs([]) }, [mode])
  // Reset QA form default audience when switching mode
  useEffect(() => {
    setQAForm(f => ({ ...f, audience: mode === 'customer' ? 'customer' : 'staff' }))
    setFileAud(mode === 'customer' ? 'customer' : 'staff')
    setUrlAud(mode === 'customer' ? 'customer' : 'staff')
  }, [mode])

  const cfg = MODES[mode]
  const ModeIcon = cfg.icon

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    setBId(profile.business_id)
    const { data } = await supabase
      .from('qa_knowledge')
      .select('*')
      .eq('business_id', profile.business_id)
      .order('created_at', { ascending: false })
    setItems((data || []) as KnowledgeItem[])
    setLoading(false)
  }

  // Filter items by mode
  const modeItems = items.filter(i => cfg.audienceFilter(i.audience || 'both'))
  const qaItems   = modeItems.filter(i => i.type === 'qa')
  const fileItems = modeItems.filter(i => i.type === 'file')
  const urlItems  = modeItems.filter(i => i.type === 'url')

  // ── Q&A ────────────────────────────────────────────────────────────────────
  async function saveQA() {
    if (!qaForm.question.trim() || !qaForm.answer.trim() || !businessId) return
    setSavingQA(true)
    if (editId) {
      await supabase.from('qa_knowledge').update({
        question: qaForm.question, answer: qaForm.answer,
        category: qaForm.category, audience: qaForm.audience,
      }).eq('id', editId)
    } else {
      await supabase.from('qa_knowledge').insert({
        business_id: businessId, type: 'qa',
        question: qaForm.question, answer: qaForm.answer,
        category: qaForm.category, audience: qaForm.audience, is_active: true,
      })
    }
    setQAForm({ question: '', answer: '', category: 'כללי', audience: mode === 'customer' ? 'customer' : 'staff' })
    setEditId(null); setShowQAForm(false); setSavingQA(false)
    loadData()
  }

  function startEditQA(item: KnowledgeItem) {
    setQAForm({ question: item.question, answer: item.answer, category: item.category, audience: item.audience || 'both' })
    setEditId(item.id); setShowQAForm(true); setTab('qa')
  }

  async function deleteItem(id: string) {
    if (!confirm('למחוק פריט זה?')) return
    await supabase.from('qa_knowledge').delete().eq('id', id)
    loadData()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('qa_knowledge').update({ is_active: !current }).eq('id', id)
    loadData()
  }

  // ── File Upload ─────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setUploading(true); setUploadMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('business_id', businessId)
    fd.append('title', fileTitle || file.name)
    fd.append('audience', fileAud)
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.ok) {
      setUploadMsg('הקובץ הועלה בהצלחה'); setFileTitle('')
      if (fileRef.current) fileRef.current.value = ''
      loadData()
    } else { setUploadMsg('שגיאה: ' + json.error) }
    setUploading(false)
    setTimeout(() => setUploadMsg(''), 4000)
  }

  // ── URL Scrape ──────────────────────────────────────────────────────────────
  async function handleScrape() {
    if (!urlInput.trim() || !businessId) return
    setScraping(true); setScrapeMsg('')
    const res = await fetch('/api/knowledge/scrape', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput, business_id: businessId, title: urlTitle, audience: urlAud }),
    })
    const json = await res.json()
    if (json.ok) {
      setScrapeMsg(`נסרקו ${json.chars?.toLocaleString() || '?'} תווים בהצלחה`)
      setUrlInput(''); setUrlTitle(''); loadData()
    } else { setScrapeMsg('שגיאה: ' + json.error) }
    setScraping(false)
    setTimeout(() => setScrapeMsg(''), 5000)
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  async function sendChat() {
    if (!chatInput.trim() || !businessId || chatLoading) return
    const q = chatInput.trim()
    setChatInput('')
    setChatMsgs(m => [...m, { role: 'user', text: q }])
    setChatLoading(true)
    const endpoint = mode === 'customer' ? '/api/knowledge/chat-customer' : '/api/knowledge/chat'
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, business_id: businessId }),
    })
    const json = await res.json()
    setChatMsgs(m => [...m, { role: 'assistant', text: json.answer || json.error || 'שגיאה' }])
    setChatLoading(false)
  }

  const TAB_DEFS = [
    { key: 'qa',    label: 'שאלות ותשובות', icon: <BookOpen size={14} />,      count: qaItems.length },
    { key: 'files', label: 'קבצים',          icon: <Paperclip size={14} />,     count: fileItems.length },
    { key: 'urls',  label: 'לינקים',          icon: <Link2 size={14} />,         count: urlItems.length },
    { key: 'chat',  label: 'צ׳אט בדיקה',      icon: <MessageSquare size={14} />, count: null },
  ] as const

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>טוען מאגר ידע...</div>

  return (
    <div style={{ padding: '32px', maxWidth: '960px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px' }}>מידע ארגוני</h1>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0 }}>הגדר מה הבוט עונה ללקוחות ומה הנציגים רואים פנימית</p>
      </div>

      {/* ─── MODE SELECTOR (main toggle) ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '28px' }}>
        {Object.values(MODES).map(m => {
          const Icon = m.icon
          const active = mode === m.key
          return (
            <button
              key={m.key}
              onClick={() => { setMode(m.key as 'customer' | 'staff'); setTab('qa'); setShowQAForm(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '18px 20px', borderRadius: '14px',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'right',
                background: active ? m.bg : 'var(--bg-surface)',
                boxShadow: active
                  ? `0 4px 16px ${m.color}22`
                  : '0 1px 3px rgba(0,0,0,0.05)',
                transition: 'all 0.2s',
                border: active ? `2px solid ${m.color}` : '2px solid var(--border-subtle)',
              } as React.CSSProperties}
            >
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
                background: active ? m.color : 'var(--bg-sunken)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                <Icon size={22} color={active ? 'white' : 'var(--fg-3)'} />
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: active ? m.color : 'var(--fg-1)' }}>
                  {m.label}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--fg-3)', fontWeight: 400 }}>
                  {m.sublabel}
                </p>
              </div>
              {active && (
                <span style={{
                  marginRight: 'auto', fontSize: '11px', fontWeight: 700,
                  padding: '3px 10px', borderRadius: '6px',
                  background: m.color, color: 'white',
                }}>
                  פעיל
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ─── Active mode banner ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 16px', borderRadius: '10px', marginBottom: '20px',
        background: cfg.bg, border: `1px solid ${cfg.border}`,
      }}>
        <ModeIcon size={16} color={cfg.color} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: cfg.color }}>
          {mode === 'customer'
            ? 'מידע זה יוצג ללקוחות על-ידי הבוט בוואטסאפ'
            : 'מידע זה גלוי לצוות הפנימי בלבד — לא יגיע ללקוחות'}
        </span>
        <span style={{ fontSize: '12px', color: cfg.color, marginRight: 'auto', opacity: 0.7 }}>
          {modeItems.length} פריטים במצב זה
        </span>
      </div>

      {/* ─── Sub-tabs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-sunken)', padding: '4px', borderRadius: '12px' }}>
        {TAB_DEFS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '9px 12px', borderRadius: '9px', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? 'var(--bg-surface)' : 'transparent',
              color: tab === t.key ? cfg.color : 'var(--fg-3)',
              boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t.icon}
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span style={{ background: tab === t.key ? cfg.color : 'var(--fg-4)', color: 'white', borderRadius: '99px', padding: '1px 6px', fontSize: '10px', fontWeight: 700 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: שאלות ותשובות ──────────────────────────────────────────────── */}
      {tab === 'qa' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button
              onClick={() => { setShowQAForm(true); setEditId(null); setQAForm({ question: '', answer: '', category: 'כללי', audience: mode === 'customer' ? 'customer' : 'staff' }) }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: cfg.color, color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              <Plus size={14} /> שאלה חדשה
            </button>
          </div>

          {showQAForm && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: `1px solid ${cfg.border}`, marginBottom: '20px', boxShadow: `0 4px 16px ${cfg.color}14` }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>{editId ? 'עריכת שאלה' : 'שאלה חדשה'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={lbl}>קטגוריה</label>
                  <select value={qaForm.category} onChange={e => setQAForm(f => ({ ...f, category: e.target.value }))} className="input-base">
                    {QA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>קהל יעד</label>
                  <select value={qaForm.audience} onChange={e => setQAForm(f => ({ ...f, audience: e.target.value }))} className="input-base">
                    {cfg.audienceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>שאלה</label>
                  <input value={qaForm.question} onChange={e => setQAForm(f => ({ ...f, question: e.target.value }))} placeholder="מה שואלים הלקוחות?" className="input-base" />
                </div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>תשובה</label>
                <textarea value={qaForm.answer} onChange={e => setQAForm(f => ({ ...f, answer: e.target.value }))} rows={4} placeholder="התשובה שתינתן..." className="input-base" style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowQAForm(false); setEditId(null) }} className="btn-ghost">ביטול</button>
                <button onClick={saveQA} disabled={savingQA || !qaForm.question.trim() || !qaForm.answer.trim()} className="btn-primary" style={{ background: cfg.color, opacity: savingQA ? 0.6 : 1 }}>
                  {savingQA ? 'שומר...' : 'שמור'}
                </button>
              </div>
            </div>
          )}

          {qaItems.length === 0
            ? <EmptyState icon={mode === 'customer' ? '🤖' : '👥'} title={`אין שאלות ותשובות ל${mode === 'customer' ? 'לקוחות' : 'צוות'} עדיין`} sub="הוסף שאלות שהבוט / הנציג יוכלו להשתמש בהן" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {qaItems.map(item => (
                  <ItemCard key={item.id} item={item} modeColor={cfg.color} onEdit={() => startEditQA(item)} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)} />
                ))}
              </div>
          }
        </div>
      )}

      {/* ── TAB: קבצים ────────────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <div>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: `1px solid ${cfg.border}`, marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>העלאת קובץ</h3>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 16px' }}>PDF, Word, Excel, TXT — תוכן הקובץ יתווסף למאגר הידע</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={lbl}>כותרת (אופציונלי)</label>
                <input value={fileTitle} onChange={e => setFileTitle(e.target.value)} placeholder='למשל: מחירון 2026' className="input-base" />
              </div>
              <div>
                <label style={lbl}>קהל יעד</label>
                <select value={fileAud} onChange={e => setFileAud(e.target.value)} className="input-base">
                  {cfg.audienceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>קובץ</label>
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ width: '100%', padding: '9px 16px', borderRadius: '8px', border: `1.5px dashed ${cfg.border}`, background: cfg.bg, color: cfg.color, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 600 }}>
                  <Upload size={14} />{uploading ? 'מעלה...' : 'בחר קובץ'}
                </button>
              </div>
            </div>
            {uploadMsg && <p style={{ fontSize: '13px', color: uploadMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '8px 0 0', fontWeight: 600 }}>{uploadMsg}</p>}
          </div>
          {fileItems.length === 0
            ? <EmptyState icon="📎" title="אין קבצים עדיין" sub="העלה מחירון, נהלים, מדריכים וכל מסמך רלוונטי" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {fileItems.map(item => (
                  <ItemCard key={item.id} item={item} modeColor={cfg.color} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                    extra={item.file_url ? <a href={item.file_url} target="_blank" style={{ fontSize: '11px', color: cfg.color }}>הורד קובץ</a> : null} />
                ))}
              </div>
          }
        </div>
      )}

      {/* ── TAB: לינקים ───────────────────────────────────────────────────────── */}
      {tab === 'urls' && (
        <div>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: `1px solid ${cfg.border}`, marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>סריקת אתר / עמוד</h3>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 16px' }}>המערכת תסרוק את הדף ותחלץ את המידע אוטומטית</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={lbl}>כותרת (אופציונלי)</label>
                <input value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="למשל: אתר הקליניקה" className="input-base" />
              </div>
              <div>
                <label style={lbl}>קהל יעד</label>
                <select value={urlAud} onChange={e => setUrlAud(e.target.value)} className="input-base">
                  {cfg.audienceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>כתובת URL</label>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.co.il" className="input-base" dir="ltr" onKeyDown={e => e.key === 'Enter' && handleScrape()} />
              </div>
            </div>
            <button onClick={handleScrape} disabled={scraping || !urlInput.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: cfg.color, color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer', opacity: scraping ? 0.7 : 1 }}>
              <Globe size={14} />{scraping ? 'סורק...' : 'סרוק עמוד'}
            </button>
            {scrapeMsg && <p style={{ fontSize: '13px', color: scrapeMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '8px 0 0', fontWeight: 600 }}>{scrapeMsg}</p>}
          </div>
          {urlItems.length === 0
            ? <EmptyState icon="🔗" title="אין לינקים עדיין" sub="הוסף את אתר הקליניקה, עמודי שירות, נהלים מקוונים" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {urlItems.map(item => (
                  <ItemCard key={item.id} item={item} modeColor={cfg.color} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                    extra={item.source_url ? <a href={item.source_url} target="_blank" style={{ fontSize: '11px', color: cfg.color }}>{item.source_url.slice(0, 45)}...</a> : null} />
                ))}
              </div>
          }
        </div>
      )}

      {/* ── TAB: צ'אט בדיקה ────────────────────────────────────────────────────── */}
      {tab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '520px', background: 'var(--bg-surface)', borderRadius: '14px', border: `1px solid ${cfg.border}`, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${cfg.border}`, background: cfg.bg, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ModeIcon size={16} color="white" />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: cfg.color }}>{cfg.chatTitle}</p>
              <p style={{ margin: '1px 0 0', fontSize: '12px', color: 'var(--fg-3)' }}>{cfg.chatSub}</p>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {chatMsgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--fg-3)' }}>
                <p style={{ fontSize: '32px', margin: '0 0 8px' }}>{mode === 'customer' ? '🤖' : '👥'}</p>
                <p style={{ fontSize: '14px', fontWeight: 500 }}>בדוק מה {mode === 'customer' ? 'הלקוח' : 'הנציג'} יקבל בתשובה</p>
                <p style={{ fontSize: '12px', marginTop: '4px' }}>{cfg.chatPlaceholder}</p>
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '75%', padding: '10px 14px',
                  borderRadius: m.role === 'user' ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
                  background: m.role === 'user' ? 'var(--bg-sunken)' : cfg.color,
                  color: m.role === 'user' ? 'var(--fg-1)' : 'white',
                  fontSize: '13px', lineHeight: 1.6,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ padding: '10px 16px', borderRadius: '12px 12px 3px 12px', background: cfg.color, color: 'white', fontSize: '13px', opacity: 0.8 }}>
                  מחפש במאגר...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '12px 16px', borderTop: `1px solid ${cfg.border}`, display: 'flex', gap: '8px', background: cfg.bg }}>
            <input
              value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder={cfg.chatPlaceholder}
              className="input-base" style={{ flex: 1 }} disabled={chatLoading}
            />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: cfg.color, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px',
}

function ItemCard({ item, modeColor, onEdit, onDelete, onToggle, extra }: {
  item: KnowledgeItem
  modeColor: string
  onEdit?: () => void
  onDelete: () => void
  onToggle: () => void
  extra?: React.ReactNode
}) {
  const audienceBadge: Record<string, string> = { both: 'לקוח + צוות', customer: 'לקוח', staff: 'צוות' }

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px 16px',
      border: `1px solid ${item.is_active ? 'var(--border-default)' : 'var(--border-subtle)'}`,
      borderRight: `3px solid ${modeColor}`,
      opacity: item.is_active ? 1 : 0.55, transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.question || item.title}
            </p>
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '5px', flexShrink: 0,
              background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}30`,
            }}>
              {audienceBadge[item.audience || 'both']}
            </span>
          </div>
          <p style={{ color: 'var(--fg-3)', fontSize: '12px', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.answer}
          </p>
          {extra && <div style={{ marginTop: '6px' }}>{extra}</div>}
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button onClick={onToggle} title={item.is_active ? 'השבת' : 'הפעל'}
            style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: item.is_active ? '#DCFCE7' : 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.is_active ? '#16A34A' : 'var(--fg-3)' }}>
            {item.is_active ? <Check size={13} /> : <X size={13} />}
          </button>
          {onEdit && (
            <button onClick={onEdit} title="ערוך"
              style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
              <Edit2 size={12} />
            </button>
          )}
          <button onClick={onDelete} title="מחק"
            style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444' }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
      <p style={{ fontSize: '36px', margin: '0 0 12px' }}>{icon}</p>
      <p style={{ color: 'var(--fg-1)', fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>{title}</p>
      <p style={{ color: 'var(--fg-3)', fontSize: '13px', margin: 0 }}>{sub}</p>
    </div>
  )
}
