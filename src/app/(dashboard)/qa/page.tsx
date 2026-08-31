'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Upload, Link2, Globe, FileText, Trash2, X } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'

interface LibraryItem {
  id: string
  type: 'file' | 'url'
  question: string
  file_url?: string
  source_url?: string
  category: string
  audience: 'both' | 'customer' | 'staff'
  is_active: boolean
  created_at: string
}

const CATEGORIES = ['כללי', 'מחירון', 'שעות ומיקום', 'שמות רופאים', 'מדיניות הנחות', 'טיפולים', 'ביטוח ומימון', 'נהלים פנימיים', 'אחר']

const AUD_META = {
  both:     { label: 'לקוחות + צוות', emoji: '👥', selBg: '#EDE9FE', selBorder: '#7C3AED', selColor: '#5B21B6', cardBg: '#EDE9FE', cardColor: '#5B21B6' },
  customer: { label: 'לקוחות',         emoji: '💬', selBg: '#DCFCE7', selBorder: '#16A34A', selColor: '#14532D', cardBg: '#DCFCE7', cardColor: '#14532D' },
  staff:    { label: 'צוות בלבד',      emoji: '🔒', selBg: '#FEF3C7', selBorder: '#D97706', selColor: '#78350F', cardBg: '#FEF3C7', cardColor: '#78350F' },
}

function timeAgo(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (d === 0) return 'היום'
  if (d === 1) return 'אתמול'
  if (d < 7)  return `לפני ${d} ימים`
  const w = Math.floor(d / 7)
  if (w < 5)  return `לפני ${w} שבועות`
  return `לפני ${Math.floor(d / 30)} חודשים`
}

export default function LibraryPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)
  const { confirm, ConfirmDialog } = useConfirm()

  const [items,       setItems]       = useState<LibraryItem[]>([])
  const [loading,     setLoading]     = useState(true)
  const [businessId,  setBId]         = useState<string | null>(null)
  const [typeFilter,  setTypeFilter]  = useState<'all' | 'file' | 'url'>('all')
  const [audFilter,   setAudFilter]   = useState<'all' | 'customer' | 'staff'>('all')

  const [showModal,   setShowModal]   = useState(false)
  const [addType,     setAddType]     = useState<'file' | 'url'>('file')

  const [fileTitle,   setFileTitle]   = useState('')
  const [fileAud,     setFileAud]     = useState<'both'|'customer'|'staff'>('both')
  const [fileCat,     setFileCat]     = useState('כללי')

  const [urlInput,    setUrlInput]    = useState('')
  const [urlTitle,    setUrlTitle]    = useState('')
  const [urlAud,      setUrlAud]      = useState<'both'|'customer'|'staff'>('both')
  const [urlCat,      setUrlCat]      = useState('כללי')
  const [urlManual,   setUrlManual]   = useState('')
  const [showManual,  setShowManual]  = useState(false)

  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState('')
  const [isDragging,  setIsDragging]  = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) { setLoading(false); return }
    setBId(profile.business_id)
    const { data } = await supabase
      .from('qa_knowledge')
      .select('*')
      .eq('business_id', profile.business_id)
      .in('type', ['file', 'url'])
      .order('created_at', { ascending: false })
    setItems((data || []) as LibraryItem[])
    setLoading(false)
  }

  const filtered = items.filter(i => {
    if (typeFilter !== 'all' && i.type !== typeFilter) return false
    if (audFilter !== 'all' && i.audience !== audFilter && !(audFilter === 'customer' && i.audience === 'both') && !(audFilter === 'staff' && i.audience === 'both')) return false
    return true
  })

  function openModal(type: 'file' | 'url') {
    setAddType(type)
    setFileTitle(''); setFileAud('both'); setFileCat('כללי')
    setUrlInput(''); setUrlTitle(''); setUrlAud('both'); setUrlCat('כללי')
    setUrlManual(''); setShowManual(false); setMsg('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false); setShowManual(false); setUrlManual(''); setMsg('')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setSaving(true); setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('business_id', businessId)
    fd.append('title', fileTitle || file.name)
    fd.append('audience', fileAud)
    fd.append('category', fileCat)
    const res  = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.ok) { closeModal(); loadData() }
    else setMsg('שגיאה: ' + json.error)
    setSaving(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleScrape() {
    if (!urlInput.trim() || !businessId) return
    setSaving(true); setMsg('')
    const res  = await fetch('/api/knowledge/scrape', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput, business_id: businessId, title: urlTitle, audience: urlAud, category: urlCat }),
    })
    const json = await res.json()
    if (json.ok) { closeModal(); loadData() }
    else if (res.status === 422 && json.error?.includes('403')) { setShowManual(true) }
    else setMsg('שגיאה: ' + json.error)
    setSaving(false)
  }

  async function handleManualSave() {
    if (!urlManual.trim() || !businessId) return
    setSaving(true)
    const { error } = await supabase.from('qa_knowledge').insert({
      business_id: businessId, type: 'url',
      question: urlTitle || urlInput, answer: urlManual,
      source_url: urlInput, category: urlCat, audience: urlAud, is_active: true,
    })
    if (error) { setMsg('שגיאה בשמירה'); setSaving(false); return }
    closeModal(); loadData()
    setSaving(false)
  }

  async function deleteItem(id: string) {
    if (!(await confirm('למחוק פריט זה?'))) return
    await supabase.from('qa_knowledge').delete().eq('id', id)
    loadData()
  }

  async function updateAudience(id: string, audience: 'both' | 'customer' | 'staff') {
    await supabase.from('qa_knowledge').update({ audience }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, audience } : i))
    setEditingId(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !businessId) return
    const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>
    handleFile(fakeEvent)
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: '12px', padding: '16px', position: 'relative',
    transition: 'border-color 0.15s',
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--fg-3)', fontSize: '14px' }}>
      טוען ספרייה...
    </div>
  )

  return (
    <div className="mobile-tight-padding" style={{ padding: '28px 36px', maxWidth: '960px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div className="flex-wrap-mobile" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>ספרייה ארגונית</h1>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: '4px 0 0' }}>
            קבצים ולינקים שהבוט לומד מהם
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => openModal('url')} style={{
            display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px',
            borderRadius: '10px', border: '1.5px solid var(--border-default)',
            background: 'var(--bg-surface)', color: 'var(--fg-2)',
            fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
          }}>
            <Link2 size={14} /> הוסף לינק
          </button>
          <button onClick={() => openModal('file')} style={{
            display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px',
            borderRadius: '10px', border: 'none',
            background: 'var(--brand)', color: 'white',
            fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
          }}>
            <Upload size={14} /> העלה קובץ
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {([
          { key: 'all',  label: 'הכל' },
          { key: 'file', label: 'קבצים' },
          { key: 'url',  label: 'לינקים' },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setTypeFilter(f.key)} style={{
            padding: '6px 14px', borderRadius: '99px', cursor: 'pointer',
            border: `1.5px solid ${typeFilter === f.key ? 'var(--brand)' : 'var(--border-subtle)'}`,
            background: typeFilter === f.key ? '#EEF2FF' : 'var(--bg-surface)',
            color: typeFilter === f.key ? '#4338CA' : 'var(--fg-3)',
            fontFamily: 'inherit', fontSize: '12px', fontWeight: typeFilter === f.key ? 600 : 400,
          }}>{f.label}</button>
        ))}
        <div style={{ width: '1px', background: 'var(--border-subtle)', margin: '0 4px' }} />
        {([
          { key: 'customer', label: 'לקוחות' },
          { key: 'staff',    label: 'צוות בלבד' },
        ] as const).map(f => (
          <button key={f.key} onClick={() => setAudFilter(audFilter === f.key ? 'all' : f.key)} style={{
            padding: '6px 14px', borderRadius: '99px', cursor: 'pointer',
            border: `1.5px solid ${audFilter === f.key ? 'var(--brand)' : 'var(--border-subtle)'}`,
            background: audFilter === f.key ? '#EEF2FF' : 'var(--bg-surface)',
            color: audFilter === f.key ? '#4338CA' : 'var(--fg-3)',
            fontFamily: 'inherit', fontSize: '12px', fontWeight: audFilter === f.key ? 600 : 400,
          }}>{f.label}</button>
        ))}
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-default)', borderRadius: '14px', color: 'var(--fg-3)' }}>
          <p style={{ fontSize: '32px', margin: '0 0 10px' }}>📂</p>
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 4px' }}>הספרייה ריקה</p>
          <p style={{ fontSize: '13px', margin: 0 }}>העלה קובץ או הוסף לינק כדי להתחיל</p>
        </div>
      ) : (
        <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          {filtered.map(item => {
            const aud    = AUD_META[item.audience]
            const isFile = item.type === 'file'
            return (
              <div key={item.id} style={card}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'}
              >
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                    background: isFile ? '#FFFBEB' : '#EFF6FF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                  }}>
                    {isFile ? '📄' : '🔗'}
                  </div>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{
                      fontSize: '10px', padding: '2px 7px', borderRadius: '99px', fontWeight: 500,
                      background: 'var(--bg-hover)', color: 'var(--fg-3)',
                      border: '1px solid var(--border-subtle)',
                    }}>{item.category}</span>
                    {editingId === item.id ? (
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {(Object.entries(AUD_META) as [keyof typeof AUD_META, typeof AUD_META['both']][]).map(([key, meta]) => (
                          <button key={key} onClick={e => { e.stopPropagation(); updateAudience(item.id, key) }} style={{
                            fontSize: '10px', padding: '2px 7px', borderRadius: '99px', fontWeight: 600, cursor: 'pointer',
                            background: item.audience === key ? meta.selBg : 'var(--bg-hover)',
                            color: item.audience === key ? meta.selColor : 'var(--fg-3)',
                            border: `1.5px solid ${item.audience === key ? meta.selBorder : 'var(--border-subtle)'}`,
                          }}>{meta.emoji} {meta.label}</button>
                        ))}
                        <button onClick={e => { e.stopPropagation(); setEditingId(null) }} style={{
                          fontSize: '10px', padding: '2px 6px', borderRadius: '99px', cursor: 'pointer',
                          background: 'transparent', border: '1.5px solid var(--border-subtle)', color: 'var(--fg-4)',
                        }}>✕</button>
                      </div>
                    ) : (
                      <span onClick={e => { e.stopPropagation(); setEditingId(item.id) }} style={{
                        fontSize: '10px', padding: '2px 7px', borderRadius: '99px', fontWeight: 500,
                        background: aud.cardBg, color: aud.cardColor, cursor: 'pointer',
                        border: '1.5px solid transparent',
                      }} title="לחץ לשינוי הרשאות">{aud.emoji} {aud.label} ✎</span>
                    )}
                  </div>
                </div>

                {/* Name */}
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 4px', lineHeight: 1.4 }}>
                  {item.question}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '0 0 28px' }}>
                  {isFile ? 'קובץ' : 'אתר'} · {timeAgo(item.created_at)}
                </p>

                {/* Hover actions */}
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', gap: '6px' }}>
                  {isFile && item.file_url && (
                    <a href={item.file_url} target="_blank" rel="noreferrer" style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 10px', borderRadius: '7px', fontSize: '11px',
                      background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)',
                      color: 'var(--fg-3)', textDecoration: 'none',
                    }}>
                      <FileText size={11} /> צפה
                    </a>
                  )}
                  {!isFile && item.source_url && (
                    <a href={item.source_url} target="_blank" rel="noreferrer" style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 10px', borderRadius: '7px', fontSize: '11px',
                      background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)',
                      color: 'var(--fg-3)', textDecoration: 'none',
                    }}>
                      <Globe size={11} /> פתח
                    </a>
                  )}
                  <button onClick={() => deleteItem(item.id)} style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '4px 10px', borderRadius: '7px', fontSize: '11px',
                    background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)',
                    color: '#EF4444', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <Trash2 size={11} /> מחק
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div style={{ background: 'var(--bg-surface)', borderRadius: '18px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)' }}>
                {addType === 'file' ? 'העלאת קובץ' : 'הוספת לינק'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '4px' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '22px' }}>
              {/* Audience */}
              <p style={lbl}>קהל יעד</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                {(['both', 'customer', 'staff'] as const).map(a => {
                  const A   = AUD_META[a]
                  const cur = addType === 'file' ? fileAud : urlAud
                  const sel = cur === a
                  return (
                    <button key={a} onClick={() => addType === 'file' ? setFileAud(a) : setUrlAud(a)} style={{
                      padding: '12px 8px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                      border: `2px solid ${sel ? A.selBorder : 'var(--border-subtle)'}`,
                      background: sel ? A.selBg : 'var(--bg-surface)',
                      transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: '20px', display: 'block', marginBottom: '5px' }}>{A.emoji}</span>
                      <span style={{ fontSize: '11px', fontWeight: sel ? 700 : 400, color: sel ? A.selColor : 'var(--fg-3)', display: 'block' }}>{A.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Category */}
              <div style={{ marginBottom: '16px' }}>
                <p style={lbl}>קטגוריה</p>
                <select
                  value={addType === 'file' ? fileCat : urlCat}
                  onChange={e => addType === 'file' ? setFileCat(e.target.value) : setUrlCat(e.target.value)}
                  className="input-base" style={{ width: '100%' }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Title */}
              <div style={{ marginBottom: '16px' }}>
                <p style={lbl}>כותרת (אופציונלי)</p>
                <input
                  value={addType === 'file' ? fileTitle : urlTitle}
                  onChange={e => addType === 'file' ? setFileTitle(e.target.value) : setUrlTitle(e.target.value)}
                  placeholder={addType === 'file' ? 'לדוגמה: מחירון 2025' : 'לדוגמה: עמוד שירותים'}
                  className="input-base" style={{ width: '100%' }}
                />
              </div>

              {/* File upload */}
              {addType === 'file' && (
                <>
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={handleFile} style={{ display: 'none' }} />
                  <div
                    onClick={() => !saving && fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    style={{
                      width: '100%', padding: '32px', borderRadius: '12px',
                      border: `2px dashed ${isDragging ? 'var(--brand)' : 'var(--border-default)'}`,
                      background: isDragging ? 'var(--brand-soft)' : 'var(--bg-sunken)',
                      cursor: saving ? 'default' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                      color: isDragging ? 'var(--brand)' : 'var(--fg-3)',
                      transition: 'all 0.15s', boxSizing: 'border-box',
                    }}>
                    <Upload size={24} style={{ color: isDragging ? 'var(--brand)' : 'var(--fg-4)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {saving ? 'מעלה...' : isDragging ? 'שחרר להעלאה' : 'גרור קובץ לכאן או לחץ לבחירה'}
                    </span>
                    <span style={{ fontSize: '11px' }}>PDF, Word, Excel, TXT</span>
                  </div>
                </>
              )}

              {/* URL */}
              {addType === 'url' && !showManual && (
                <>
                  <div style={{ marginBottom: '8px' }}>
                    <p style={lbl}>כתובת URL</p>
                    <input
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      placeholder="https://..."
                      className="input-base" style={{ width: '100%' }} dir="ltr"
                      onKeyDown={e => e.key === 'Enter' && handleScrape()}
                    />
                  </div>
                </>
              )}

              {/* Manual fallback */}
              {addType === 'url' && showManual && (
                <>
                  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '13px', color: '#92400E' }}>האתר חוסם גישה אוטומטית</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#B45309', lineHeight: 1.5 }}>
                      הכנס לדף <a href={urlInput} target="_blank" rel="noreferrer" style={{ color: '#7C3AED', fontWeight: 600 }} dir="ltr">{urlInput}</a>, העתק את הטקסט והדבק כאן:
                    </p>
                  </div>
                  <textarea
                    value={urlManual}
                    onChange={e => setUrlManual(e.target.value)}
                    rows={6} className="input-base" style={{ width: '100%', resize: 'vertical' }}
                    placeholder="הדבק כאן את הטקסט מהעמוד..."
                  />
                </>
              )}

              {msg && <p style={{ fontSize: '12px', color: '#EF4444', margin: '8px 0 0', fontWeight: 600 }}>{msg}</p>}

              {/* Actions */}
              {addType === 'url' && (
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <button onClick={closeModal} className="btn-ghost">ביטול</button>
                  {!showManual ? (
                    <button onClick={handleScrape} disabled={saving || !urlInput.trim()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: saving ? 0.6 : 1 }}>
                      <Link2 size={13} />{saving ? 'סורק...' : 'סרוק עמוד'}
                    </button>
                  ) : (
                    <button onClick={handleManualSave} disabled={saving || !urlManual.trim()} className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }}>
                      {saving ? 'שומר...' : 'שמור טקסט'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 6px',
}
