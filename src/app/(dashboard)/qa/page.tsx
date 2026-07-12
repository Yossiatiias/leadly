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

const AUDIENCE = {
  customer: { label: 'בוט לקוחות', short: 'לקוח',   color: '#10B981', bg: '#ECFDF5' },
  staff:    { label: 'צוות פנימי', short: 'צוות',    color: '#8B5CF6', bg: '#F5F3FF' },
  both:     { label: 'לקוח + צוות', short: 'שניהם', color: '#3B82F6', bg: '#EFF6FF' },
}

export default function KnowledgePage() {
  const supabase = createClient()
  const [tab, setTab]         = useState<'qa' | 'files' | 'urls' | 'chat'>('qa')
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'customer' | 'staff' | 'both'>('all')
  const [chatMode, setChatMode] = useState<'customer' | 'staff'>('customer')
  const [items, setItems]     = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [businessId, setBId]  = useState<string | null>(null)

  // Q&A form
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [qaForm,    setQAForm]    = useState({ question: '', answer: '', category: 'כללי', audience: 'both' })
  const [savingQA,  setSavingQA]  = useState(false)

  // File
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileTitle, setFileTitle] = useState('')
  const [fileAud,   setFileAud]   = useState('both')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  // URL
  const [urlInput,  setUrlInput]  = useState('')
  const [urlTitle,  setUrlTitle]  = useState('')
  const [urlAud,    setUrlAud]    = useState('both')
  const [scraping,  setScraping]  = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')

  // Chat
  const [chatInput,   setChatInput]   = useState('')
  const [chatMsgs,    setChatMsgs]    = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadData() }, [])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])
  useEffect(() => { setChatMsgs([]) }, [chatMode])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    setBId(profile.business_id)
    const { data } = await supabase
      .from('qa_knowledge').select('*')
      .eq('business_id', profile.business_id)
      .order('created_at', { ascending: false })
    setItems((data || []) as KnowledgeItem[])
    setLoading(false)
  }

  const visibleItems = items.filter(i => {
    const typeMatch = tab === 'qa' ? i.type === 'qa' : tab === 'files' ? i.type === 'file' : i.type === 'url'
    const audMatch  = audienceFilter === 'all' || i.audience === audienceFilter
    return typeMatch && audMatch
  })

  // ── Q&A ──────────────────────────────────────────────────────────────────
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
    resetForm(); setSavingQA(false); loadData()
  }

  function resetForm() {
    setQAForm({ question: '', answer: '', category: 'כללי', audience: 'both' })
    setEditId(null); setShowForm(false)
  }

  function startEdit(item: KnowledgeItem) {
    setQAForm({ question: item.question, answer: item.answer, category: item.category, audience: item.audience || 'both' })
    setEditId(item.id); setShowForm(true); setTab('qa')
  }

  async function deleteItem(id: string) {
    if (!confirm('למחוק פריט זה?')) return
    await supabase.from('qa_knowledge').delete().eq('id', id); loadData()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('qa_knowledge').update({ is_active: !current }).eq('id', id); loadData()
  }

  // ── File Upload ───────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setUploading(true); setUploadMsg('')
    const fd = new FormData()
    fd.append('file', file); fd.append('business_id', businessId)
    fd.append('title', fileTitle || file.name); fd.append('audience', fileAud)
    const res  = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
    const json = await res.json()
    setUploadMsg(json.ok ? 'הקובץ הועלה בהצלחה' : 'שגיאה: ' + json.error)
    setFileTitle(''); if (fileRef.current) fileRef.current.value = ''
    if (json.ok) loadData()
    setUploading(false); setTimeout(() => setUploadMsg(''), 4000)
  }

  // ── URL Scrape ────────────────────────────────────────────────────────────
  async function handleScrape() {
    if (!urlInput.trim() || !businessId) return
    setScraping(true); setScrapeMsg('')
    const res  = await fetch('/api/knowledge/scrape', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput, business_id: businessId, title: urlTitle, audience: urlAud }),
    })
    const json = await res.json()
    setScrapeMsg(json.ok ? `נסרקו ${json.chars?.toLocaleString() || '?'} תווים` : 'שגיאה: ' + json.error)
    if (json.ok) { setUrlInput(''); setUrlTitle(''); loadData() }
    setScraping(false); setTimeout(() => setScrapeMsg(''), 5000)
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function sendChat() {
    if (!chatInput.trim() || !businessId || chatLoading) return
    const q = chatInput.trim(); setChatInput('')
    setChatMsgs(m => [...m, { role: 'user', text: q }]); setChatLoading(true)
    const endpoint = chatMode === 'customer' ? '/api/knowledge/chat-customer' : '/api/knowledge/chat'
    const res  = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, business_id: businessId }),
    })
    const json = await res.json()
    setChatMsgs(m => [...m, { role: 'assistant', text: json.answer || json.error || 'שגיאה' }])
    setChatLoading(false)
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const counts = {
    qa:    items.filter(i => i.type === 'qa').length,
    files: items.filter(i => i.type === 'file').length,
    urls:  items.filter(i => i.type === 'url').length,
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>טוען...</div>

  return (
    <div style={{ padding: '28px 32px', maxWidth: '920px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 3px' }}>מידע ארגוני</h1>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0 }}>{items.length} פריטים במאגר</p>
        </div>
        {tab !== 'chat' && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
          >
            <Plus size={14} /> הוסף פריט
          </button>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: 'var(--bg-sunken)', padding: '4px', borderRadius: '12px' }}>
        {([
          { key: 'qa',    label: 'שאלות ותשובות', icon: <BookOpen size={14} />,      count: counts.qa },
          { key: 'files', label: 'קבצים',          icon: <Paperclip size={14} />,     count: counts.files },
          { key: 'urls',  label: 'לינקים',          icon: <Link2 size={14} />,         count: counts.urls },
          { key: 'chat',  label: 'צ׳אט בדיקה',      icon: <MessageSquare size={14} />, count: null },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '9px 10px', borderRadius: '9px', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '13px', fontWeight: tab === t.key ? 600 : 400,
            background: tab === t.key ? 'var(--bg-surface)' : 'transparent',
            color: tab === t.key ? 'var(--fg-1)' : 'var(--fg-3)',
            boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s',
          }}>
            {t.icon} {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{ background: tab === t.key ? 'var(--brand)' : 'var(--fg-4)', color: 'white', borderRadius: '99px', padding: '1px 6px', fontSize: '10px', fontWeight: 700 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Audience filter (not in chat tab) ────────────────────────────────── */}
      {tab !== 'chat' && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--fg-3)', fontWeight: 500, marginLeft: '4px' }}>קהל יעד:</span>
          {([
            { key: 'all',      label: 'הכל' },
            { key: 'customer', label: '🤖 בוט לקוחות' },
            { key: 'staff',    label: '👥 צוות פנימי' },
            { key: 'both',     label: '🔵 שניהם' },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setAudienceFilter(f.key)} style={{
              padding: '5px 12px', borderRadius: '7px', border: '1.5px solid',
              fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              borderColor: audienceFilter === f.key
                ? (f.key === 'customer' ? '#10B981' : f.key === 'staff' ? '#8B5CF6' : f.key === 'both' ? '#3B82F6' : 'var(--brand)')
                : 'var(--border-subtle)',
              background: audienceFilter === f.key
                ? (f.key === 'customer' ? '#ECFDF5' : f.key === 'staff' ? '#F5F3FF' : f.key === 'both' ? '#EFF6FF' : 'var(--bg-hover)')
                : 'var(--bg-surface)',
              color: audienceFilter === f.key
                ? (f.key === 'customer' ? '#10B981' : f.key === 'staff' ? '#8B5CF6' : f.key === 'both' ? '#3B82F6' : 'var(--fg-1)')
                : 'var(--fg-3)',
              transition: 'all 0.15s',
            }}>{f.label}</button>
          ))}
        </div>
      )}

      {/* ── Q&A form ─────────────────────────────────────────────────────────── */}
      {showForm && tab === 'qa' && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '22px', border: '1px solid var(--border-default)', marginBottom: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>{editId ? 'עריכת שאלה' : 'שאלה חדשה'}</h3>
            <button onClick={resetForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)' }}><X size={16} /></button>
          </div>

          {/* Audience selector — prominent */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', padding: '12px', background: 'var(--bg-sunken)', borderRadius: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', lineHeight: '32px' }}>מי יראה את זה?</span>
            {(['both', 'customer', 'staff'] as const).map(a => {
              const ac = AUDIENCE[a]
              const sel = qaForm.audience === a
              return (
                <button key={a} onClick={() => setQAForm(f => ({ ...f, audience: a }))} style={{
                  padding: '6px 14px', borderRadius: '8px', border: `1.5px solid ${sel ? ac.color : 'var(--border-subtle)'}`,
                  background: sel ? ac.bg : 'var(--bg-surface)', color: sel ? ac.color : 'var(--fg-3)',
                  fontFamily: 'inherit', fontSize: '12px', fontWeight: sel ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {a === 'customer' ? '🤖' : a === 'staff' ? '👥' : '🔵'} {ac.label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={lbl}>קטגוריה</label>
              <select value={qaForm.category} onChange={e => setQAForm(f => ({ ...f, category: e.target.value }))} className="input-base">
                {QA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>שאלה</label>
              <input value={qaForm.question} onChange={e => setQAForm(f => ({ ...f, question: e.target.value }))} placeholder="מה שואלים?" className="input-base" />
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={lbl}>
              תשובה
              {qaForm.audience !== 'both' && (
                <span style={{ marginRight: '8px', fontSize: '11px', fontWeight: 400, color: AUDIENCE[qaForm.audience as 'customer' | 'staff'].color }}>
                  ({qaForm.audience === 'customer' ? 'תשובה ללקוח בלבד' : 'תשובה לצוות בלבד — יכולה לכלול מידע פנימי'})
                </span>
              )}
            </label>
            <textarea value={qaForm.answer} onChange={e => setQAForm(f => ({ ...f, answer: e.target.value }))} rows={4} className="input-base" style={{ resize: 'vertical' }} placeholder={
              qaForm.audience === 'staff' ? 'יישור שיניים: 5,000–10,000 ₪. ניתן לתת עד 10% הנחה.' :
              qaForm.audience === 'customer' ? 'יישור שיניים נע בין 5,000 ל-10,000 ₪ בהתאם למצב הפה.' :
              'כתוב את התשובה כאן...'
            } />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={resetForm} className="btn-ghost">ביטול</button>
            <button onClick={saveQA} disabled={savingQA || !qaForm.question.trim() || !qaForm.answer.trim()} className="btn-primary" style={{ opacity: savingQA ? 0.6 : 1 }}>
              {savingQA ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      )}

      {/* ── Q&A list ──────────────────────────────────────────────────────────── */}
      {tab === 'qa' && (
        visibleItems.length === 0
          ? <Empty icon="💡" title="אין שאלות ותשובות" sub="לחץ על + הוסף פריט כדי להתחיל" />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {visibleItems.map(item => (
                <ItemCard key={item.id} item={item}
                  onEdit={() => startEdit(item)}
                  onDelete={() => deleteItem(item.id)}
                  onToggle={() => toggleActive(item.id, item.is_active)} />
              ))}
            </div>
      )}

      {/* ── Files ─────────────────────────────────────────────────────────────── */}
      {tab === 'files' && (
        <div>
          {showForm && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '22px', border: '1px solid var(--border-default)', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>העלאת קובץ</h3>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)' }}><X size={16} /></button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 14px' }}>PDF, Word, Excel, TXT</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={lbl}>כותרת (אופציונלי)</label>
                  <input value={fileTitle} onChange={e => setFileTitle(e.target.value)} placeholder="מחירון 2026" className="input-base" />
                </div>
                <div>
                  <label style={lbl}>קהל יעד</label>
                  <select value={fileAud} onChange={e => setFileAud(e.target.value)} className="input-base">
                    <option value="both">לקוח + צוות</option>
                    <option value="customer">בוט לקוחות בלבד</option>
                    <option value="staff">צוות פנימי בלבד</option>
                  </select>
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={handleFileUpload} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: '1.5px dashed var(--border-default)', background: 'var(--bg-sunken)', color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500 }}>
                <Upload size={14} />{uploading ? 'מעלה...' : 'בחר קובץ'}
              </button>
              {uploadMsg && <p style={{ fontSize: '13px', color: uploadMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '10px 0 0', fontWeight: 600 }}>{uploadMsg}</p>}
            </div>
          )}
          {visibleItems.length === 0
            ? <Empty icon="📎" title="אין קבצים" sub="לחץ על + הוסף פריט להעלאה" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {visibleItems.map(item => (
                  <ItemCard key={item.id} item={item} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                    extra={item.file_url ? <a href={item.file_url} target="_blank" style={{ fontSize: '11px', color: 'var(--brand)' }}>הורד קובץ</a> : null} />
                ))}
              </div>
          }
        </div>
      )}

      {/* ── URLs ──────────────────────────────────────────────────────────────── */}
      {tab === 'urls' && (
        <div>
          {showForm && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: '14px', padding: '22px', border: '1px solid var(--border-default)', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg-1)' }}>סריקת עמוד</h3>
                <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)' }}><X size={16} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={lbl}>כותרת (אופציונלי)</label>
                  <input value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="אתר הקליניקה" className="input-base" />
                </div>
                <div>
                  <label style={lbl}>קהל יעד</label>
                  <select value={urlAud} onChange={e => setUrlAud(e.target.value)} className="input-base">
                    <option value="both">לקוח + צוות</option>
                    <option value="customer">בוט לקוחות בלבד</option>
                    <option value="staff">צוות פנימי בלבד</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>כתובת URL</label>
                  <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://..." className="input-base" dir="ltr" onKeyDown={e => e.key === 'Enter' && handleScrape()} />
                </div>
              </div>
              <button onClick={handleScrape} disabled={scraping || !urlInput.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', border: 'none', background: 'var(--brand)', color: 'white', fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer', opacity: scraping ? 0.7 : 1 }}>
                <Globe size={14} />{scraping ? 'סורק...' : 'סרוק עמוד'}
              </button>
              {scrapeMsg && <p style={{ fontSize: '13px', color: scrapeMsg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '10px 0 0', fontWeight: 600 }}>{scrapeMsg}</p>}
            </div>
          )}
          {visibleItems.length === 0
            ? <Empty icon="🔗" title="אין לינקים" sub="לחץ על + הוסף פריט לסריקת עמוד" />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {visibleItems.map(item => (
                  <ItemCard key={item.id} item={item} onDelete={() => deleteItem(item.id)} onToggle={() => toggleActive(item.id, item.is_active)}
                    extra={item.source_url ? <a href={item.source_url} target="_blank" style={{ fontSize: '11px', color: 'var(--brand)' }}>{item.source_url.slice(0, 50)}</a> : null} />
                ))}
              </div>
          }
        </div>
      )}

      {/* ── Chat ──────────────────────────────────────────────────────────────── */}
      {tab === 'chat' && (
        <div>
          {/* Mode toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            {(['customer', 'staff'] as const).map(m => {
              const ac = AUDIENCE[m]
              const sel = chatMode === m
              return (
                <button key={m} onClick={() => setChatMode(m)} style={{
                  padding: '14px 20px', borderRadius: '12px', border: `2px solid ${sel ? ac.color : 'var(--border-subtle)'}`,
                  background: sel ? ac.bg : 'var(--bg-surface)', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.15s',
                }}>
                  <span style={{ fontSize: '22px' }}>{m === 'customer' ? '🤖' : '👥'}</span>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: sel ? ac.color : 'var(--fg-1)' }}>{ac.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--fg-3)', fontWeight: 400 }}>
                      {m === 'customer' ? 'בדוק מה הלקוח יקבל מהבוט' : 'בדוק מה הנציג יראה פנימית'}
                    </p>
                  </div>
                  {sel && <span style={{ marginRight: 'auto', fontSize: '10px', background: ac.color, color: 'white', padding: '2px 8px', borderRadius: '5px', fontWeight: 700 }}>פעיל</span>}
                </button>
              )
            })}
          </div>

          {/* Chat UI */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '460px', background: 'var(--bg-surface)', borderRadius: '14px', border: `2px solid ${AUDIENCE[chatMode].color}30`, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${AUDIENCE[chatMode].color}20`, background: AUDIENCE[chatMode].bg, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>{chatMode === 'customer' ? '🤖' : '👥'}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: AUDIENCE[chatMode].color }}>
                {chatMode === 'customer' ? 'בדיקה: מה הלקוח יקבל?' : 'בדיקה: מה הצוות יראה?'}
              </span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {chatMsgs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--fg-3)' }}>
                  <p style={{ fontSize: '32px', margin: '0 0 8px' }}>{chatMode === 'customer' ? '🤖' : '👥'}</p>
                  <p style={{ fontSize: '14px', fontWeight: 500, margin: '0 0 4px' }}>
                    {chatMode === 'customer' ? 'שאל כמו שהלקוח ישאל' : 'שאל שאלה פנימית של נציג'}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--fg-4)' }}>
                    {chatMode === 'customer' ? 'כמה עולה השתלת שיניים?' : 'מה ההנחה המקסימלית שאפשר לתת?'}
                  </p>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '78%', padding: '10px 14px', fontSize: '13px', lineHeight: 1.6,
                    borderRadius: m.role === 'user' ? '12px 12px 12px 3px' : '12px 12px 3px 12px',
                    background: m.role === 'user' ? 'var(--bg-sunken)' : AUDIENCE[chatMode].color,
                    color: m.role === 'user' ? 'var(--fg-1)' : 'white',
                  }}>{m.text}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ padding: '10px 16px', borderRadius: '12px 12px 3px 12px', background: AUDIENCE[chatMode].color, color: 'white', fontSize: '13px', opacity: 0.8 }}>
                    חושב...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div style={{ padding: '12px 16px', borderTop: `1px solid ${AUDIENCE[chatMode].color}20`, display: 'flex', gap: '8px', background: AUDIENCE[chatMode].bg }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder={chatMode === 'customer' ? 'כמה עולה יישור שיניים?' : 'מה ההנחה המקסימלית?'}
                className="input-base" style={{ flex: 1 }} disabled={chatLoading} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: AUDIENCE[chatMode].color, color: 'white', cursor: 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
                <Send size={14} />
              </button>
            </div>
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

function ItemCard({ item, onEdit, onDelete, onToggle, extra }: {
  item: KnowledgeItem; onEdit?: () => void
  onDelete: () => void; onToggle: () => void; extra?: React.ReactNode
}) {
  const aud = AUDIENCE[item.audience || 'both']
  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: '12px', padding: '14px 16px',
      border: '1px solid var(--border-subtle)', borderRight: `3px solid ${aud.color}`,
      opacity: item.is_active ? 1 : 0.5, transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.question || item.title}
            </p>
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '5px', flexShrink: 0, background: aud.bg, color: aud.color }}>
              {aud.short}
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

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-surface)', borderRadius: '14px', border: '1px solid var(--border-subtle)' }}>
      <p style={{ fontSize: '36px', margin: '0 0 12px' }}>{icon}</p>
      <p style={{ color: 'var(--fg-1)', fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>{title}</p>
      <p style={{ color: 'var(--fg-3)', fontSize: '13px', margin: 0 }}>{sub}</p>
    </div>
  )
}
