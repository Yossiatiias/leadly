'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Paperclip, Link2, MessageSquare, BookOpen, Trash2, Edit2, Plus, Send, Globe, Upload, Check, X } from 'lucide-react'

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

const AUDIENCE_LABELS: Record<string, string> = {
  both:     'לקוח + צוות',
  customer: 'לקוח בלבד',
  staff:    'צוות בלבד',
}
const AUDIENCE_COLORS: Record<string, string> = {
  both:     '#6366F1',
  customer: '#10B981',
  staff:    '#F59E0B',
}

interface ChatMsg { role: 'user' | 'assistant'; text: string }

const QA_CATEGORIES = ['כללי', 'שעות פעילות', 'מחירים', 'שירותים', 'צוות', 'מיקום והגעה', 'אחר']

export default function KnowledgePage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'qa' | 'files' | 'urls' | 'chat'>('qa')
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState<string | null>(null)

  // Q&A form
  const [showQAForm, setShowQAForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [qaForm, setQAForm] = useState({ question: '', answer: '', category: 'כללי', audience: 'both' })
  const [savingQA, setSavingQA] = useState(false)

  // File upload
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileTitle, setFileTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  // URL scrape
  const [urlInput, setUrlInput] = useState('')
  const [urlTitle, setUrlTitle] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')

  // Chat
  const [chatInput, setChatInput] = useState('')
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadData() }, [])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    setBusinessId(profile.business_id)
    const { data } = await supabase
      .from('qa_knowledge')
      .select('*')
      .eq('business_id', profile.business_id)
      .order('created_at', { ascending: false })
    setItems((data || []) as KnowledgeItem[])
    setLoading(false)
  }

  // ── Q&A ──────────────────────────────────────────────────────────────────────
  async function saveQA() {
    if (!qaForm.question.trim() || !qaForm.answer.trim() || !businessId) return
    setSavingQA(true)
    if (editId) {
      await supabase.from('qa_knowledge').update({ question: qaForm.question, answer: qaForm.answer, category: qaForm.category, audience: qaForm.audience }).eq('id', editId)
    } else {
      await supabase.from('qa_knowledge').insert({ business_id: businessId, type: 'qa', question: qaForm.question, answer: qaForm.answer, category: qaForm.category, audience: qaForm.audience, is_active: true })
    }
    setQAForm({ question: '', answer: '', category: 'כללי', audience: 'both' })
    setEditId(null)
    setShowQAForm(false)
    setSavingQA(false)
    loadData()
  }

  function startEditQA(item: KnowledgeItem) {
    setQAForm({ question: item.question, answer: item.answer, category: item.category, audience: item.audience || 'both' })
    setEditId(item.id)
    setShowQAForm(true)
    setTab('qa')
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

  // ── File Upload ───────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setUploading(true)
    setUploadMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('business_id', businessId)
    fd.append('title', fileTitle || file.name)
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.ok) {
      setUploadMsg('הקובץ הועלה בהצלחה')
      setFileTitle('')
      if (fileRef.current) fileRef.current.value = ''
      loadData()
    } else {
      setUploadMsg('שגיאה: ' + json.error)
    }
    setUploading(false)
    setTimeout(() => setUploadMsg(''), 4000)
  }

  // ── URL Scrape ────────────────────────────────────────────────────────────────
  async function handleScrape() {
    if (!urlInput.trim() || !businessId) return
    setScraping(true)
    setScrapeMsg('')
    const res = await fetch('/api/knowledge/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput, business_id: businessId, title: urlTitle }),
    })
    const json = await res.json()
    if (json.ok) {
      setScrapeMsg(`נסרקו ${json.chars?.toLocaleString() || '?'} תווים בהצלחה`)
      setUrlInput('')
      setUrlTitle('')
      loadData()
    } else {
      setScrapeMsg('שגיאה: ' + json.error)
    }
    setScraping(false)
    setTimeout(() => setScrapeMsg(''), 5000)
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────
  async function sendChat() {
    if (!chatInput.trim() || !businessId || chatLoading) return
    const q = chatInput.trim()
    setChatInput('')
    setChatMsgs(m => [...m, { role: 'user', text: q }])
    setChatLoading(true)
    const res = await fetch('/api/knowledge/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, business_id: businessId }),
    })
    const json = await res.json()
    setChatMsgs(m => [...m, { role: 'assistant', text: json.answer || json.error || 'שגיאה' }])
    setChatLoading(false)
  }

  // ── Filtered items ────────────────────────────────────────────────────────────
  const qaItems   = items.filter(i => i.type === 'qa')
  const fileItems = items.filter(i => i.type === 'file')
  const urlItems  = items.filter(i => i.type === 'url')

  const TAB_DEFS = [
    { key: 'qa',    label: 'שאלות ותשובות', icon: <BookOpen size={15} />,      count: qaItems.length },
    { key: 'files', label: 'קבצים',          icon: <Paperclip size={15} />,     count: fileItems.length },
    { key: 'urls',  label: 'לינקים',          icon: <Link2 size={15} />,         count: urlItems.length },
    { key: 'chat',  label: 'צ׳אט פנימי',      icon: <MessageSquare size={15} />, count: null },
  ] as const

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>טוען מאגר ידע...</div>

  return (
    <div style={{ padding: '32px', maxWidth: '900px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--fg-1)', margin: 0 }}>מידע ארגוני</h1>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', marginTop: '4px' }}>
          מאגר הידע שממנו הבוט והנציגים שואבים מידע על הארגון
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'שאלות ותשובות', value: qaItems.length, color: '#3B82F6' },
          { label: 'קבצים',          value: fileItems.length, color: '#8B5CF6' },
          { label: 'לינקים',          value: urlItems.length, color: '#10B981' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px 20px' }}>
            <p style={{ fontSize: '24px', fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '2px 0 0' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
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
              color: tab === t.key ? 'var(--fg-1)' : 'var(--fg-3)',
              boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {t.icon}
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span style={{ background: tab === t.key ? '#3B82F6' : 'var(--fg-4)', color: 'white', borderRadius: '99px', padding: '1px 6px', fontSize: '10px', fontWeight: 700 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: שאלות ותשובות ─────────────────────────────────────────────── */}
      {tab === 'qa' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button
              onClick={() => { setShowQAForm(true); setEditId(null); setQAForm({ question: '', answer: '', category: 'כללי' }) }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#3B82F6', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              <Plus size={14} /> שאלה חדשה
            </button>
          </div>

          {showQAForm && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: '1px solid var(--border-subtle)', marginBottom: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>{editId ? 'עריכת שאלה' : 'שאלה חדשה'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>קטגוריה</label>
                  <select value={qaForm.category} onChange={e => setQAForm(f => ({ ...f, category: e.target.value }))} className="input-base">
                    {QA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>קהל יעד</label>
                  <select value={qaForm.audience} onChange={e => setQAForm(f => ({ ...f, audience: e.target.value }))} className="input-base">
                    <option value="both">לקוח + צוות</option>
                    <option value="customer">לקוח בלבד</option>
                    <option value="staff">צוות בלבד</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>שאלה</label>
                  <input value={qaForm.question} onChange={e => setQAForm(f => ({ ...f, question: e.target.value }))} placeholder="כמה עולה טיפול שורש?" className="input-base" />
                </div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>תשובה</label>
                <textarea value={qaForm.answer} onChange={e => setQAForm(f => ({ ...f, answer: e.target.value }))} rows={4} placeholder="טיפול שורש עולה בין 800-1500 ש״ח בהתאם למורכבות..." className="input-base" style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowQAForm(false); setEditId(null) }} className="btn-ghost">ביטול</button>
                <button onClick={saveQA} disabled={savingQA || !qaForm.question.trim() || !qaForm.answer.trim()} className="btn-primary" style={{ opacity: savingQA ? 0.6 : 1 }}>
                  {savingQA ? 'שומר...' : 'שמור'}
                </button>
              </div>
            </div>
          )}

          {qaItems.length === 0 ? (
            <EmptyState icon="💡" title="אין שאלות ותשובות עדיין" sub="הוסף שאלות נפוצות שהבוט יוכל להשתמש בהן" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {qaItems.map(item => (
                <ItemCard key={item.id} item={item} onEdit={() => startEditQA(item)} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: קבצים ────────────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <div>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>העלאת קובץ</h3>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 16px' }}>PDF, Word, Excel, TXT — תוכן הקובץ יתווסף למאגר הידע</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>כותרת (אופציונלי)</label>
                <input value={fileTitle} onChange={e => setFileTitle(e.target.value)} placeholder="למשל: מחירון 2026" className="input-base" />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>קובץ</label>
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ width: '100%', padding: '9px 16px', borderRadius: '8px', border: '1.5px dashed var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <Upload size={14} />
                  {uploading ? 'מעלה...' : 'בחר קובץ'}
                </button>
              </div>
            </div>
            {uploadMsg && (
              <p style={{ fontSize: '13px', color: uploadMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '8px 0 0', fontWeight: 600 }}>{uploadMsg}</p>
            )}
          </div>

          {fileItems.length === 0 ? (
            <EmptyState icon="📎" title="אין קבצים עדיין" sub="העלה מחירון, רשימת רופאים, מדריכים וכל מסמך רלוונטי" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {fileItems.map(item => (
                <ItemCard key={item.id} item={item} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                  extra={item.file_url ? <a href={item.file_url} target="_blank" style={{ fontSize: '11px', color: '#3B82F6' }}>הורד קובץ</a> : null} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: לינקים ───────────────────────────────────────────────────────── */}
      {tab === 'urls' && (
        <div>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '24px', border: '1px solid var(--border-subtle)', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>סריקת אתר / עמוד</h3>
            <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 16px' }}>המערכת תסרוק את הדף ותחלץ את המידע אוטומטית</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>כותרת (אופציונלי)</label>
                <input value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="למשל: אתר הקליניקה" className="input-base" />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px' }}>כתובת URL</label>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.co.il" className="input-base" dir="ltr" onKeyDown={e => e.key === 'Enter' && handleScrape()} />
              </div>
            </div>
            <button onClick={handleScrape} disabled={scraping || !urlInput.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#10B981', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer', opacity: scraping ? 0.7 : 1 }}>
              <Globe size={14} />
              {scraping ? 'סורק...' : 'סרוק עמוד'}
            </button>
            {scrapeMsg && (
              <p style={{ fontSize: '13px', color: scrapeMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '8px 0 0', fontWeight: 600 }}>{scrapeMsg}</p>
            )}
          </div>

          {urlItems.length === 0 ? (
            <EmptyState icon="🔗" title="אין לינקים עדיין" sub="הוסף את אתר הקליניקה, עמודי שירות או כל מקור מידע מהרשת" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {urlItems.map(item => (
                <ItemCard key={item.id} item={item} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                  extra={item.source_url ? <a href={item.source_url} target="_blank" style={{ fontSize: '11px', color: '#10B981' }}>{item.source_url.slice(0, 40)}...</a> : null} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: צ'אט פנימי ───────────────────────────────────────────────────── */}
      {tab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: '500px', background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '14px', color: 'var(--fg-1)' }}>שאל את מאגר הידע</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--fg-3)' }}>הבוט יחפש בכל שאלות התשובות, הקבצים והלינקים שהוספת</p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {chatMsgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--fg-3)' }}>
                <p style={{ fontSize: '28px', margin: '0 0 8px' }}>💬</p>
                <p style={{ fontSize: '14px', fontWeight: 500 }}>שאל כל שאלה על הארגון</p>
                <p style={{ fontSize: '12px' }}>למשל: כמה עולה השתלת שיניים? מי הרופאים שלנו? מה שעות הפעילות?</p>
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  maxWidth: '75%', padding: '10px 14px', borderRadius: m.role === 'user' ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
                  background: m.role === 'user' ? 'var(--bg-sunken)' : '#3B82F6',
                  color: m.role === 'user' ? 'var(--fg-1)' : 'white',
                  fontSize: '13px', lineHeight: 1.6,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ padding: '10px 16px', borderRadius: '12px 12px 3px 12px', background: '#3B82F6', color: 'white', fontSize: '13px' }}>
                  מחפש במאגר...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '8px' }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="שאל שאלה על הארגון..."
              className="input-base"
              style={{ flex: 1 }}
              disabled={chatLoading}
            />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: '#3B82F6', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Item Card ─────────────────────────────────────────────────────────────────
function ItemCard({ item, onEdit, onDelete, onToggle, extra }: {
  item: KnowledgeItem
  onEdit?: () => void
  onDelete: () => void
  onToggle: () => void
  extra?: React.ReactNode
}) {
  const audience = item.audience || 'both'
  const audienceColor = AUDIENCE_COLORS[audience] || '#6366F1'

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px 16px',
      border: `1px solid ${item.is_active ? 'var(--border-default)' : 'var(--border-subtle)'}`,
      opacity: item.is_active ? 1 : 0.55, transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
              {item.question || item.title}
            </p>
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '5px', flexShrink: 0,
              background: `${audienceColor}18`, color: audienceColor, border: `1px solid ${audienceColor}30`,
            }}>
              {AUDIENCE_LABELS[audience]}
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
