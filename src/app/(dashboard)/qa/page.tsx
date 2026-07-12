'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Plus, Search, Trash2, Edit2, Check, X,
  FileText, Link2, MessageSquare, Upload, Globe, AlertCircle,
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

const CATEGORIES = ['הכל', 'מחירון', 'שעות ומיקום', 'שמות רופאים', 'מדיניות הנחות', 'טיפולים', 'ביטוח ומימון', 'נהלים פנימיים', 'כללי', 'אחר']
const ITEM_CATEGORIES = CATEGORIES.slice(1)

const AUD = {
  both:     { label: 'שניהם',         emoji: '🔵', bg: '#EFF6FF', color: '#1E3A8A', border: '#BFDBFE' },
  customer: { label: 'בוט לקוחות',    emoji: '🤖', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  staff:    { label: 'צוות בלבד',     emoji: '👥', bg: '#F5F3FF', color: '#4C1D95', border: '#DDD6FE' },
}

const TYPE_META = {
  qa:   { icon: '💬', label: 'שאלה ותשובה', bg: '#EEF2FF' },
  file: { icon: '📄', label: 'קובץ',         bg: '#FFFBEB' },
  url:  { icon: '🔗', label: 'לינק',          bg: '#F0FDF4' },
}

type ModalStep = 'type' | 'form'
type AddType = 'qa' | 'file' | 'url'

export default function KnowledgePage() {
  const router = useRouter()
  const supabase = createClient()

  const [items, setItems]             = useState<KnowledgeItem[]>([])
  const [loading, setLoading]         = useState(true)
  const [businessId, setBId]          = useState<string | null>(null)
  const [gapCount, setGapCount]       = useState(0)

  const [search, setSearch]           = useState('')
  const [audFilter, setAudFilter]     = useState<'all' | 'customer' | 'staff' | 'both'>('all')
  const [catFilter, setCatFilter]     = useState('הכל')
  const [activeOnly, setActiveOnly]   = useState(false)

  const [showModal, setShowModal]     = useState(false)
  const [step, setStep]               = useState<ModalStep>('type')
  const [addType, setAddType]         = useState<AddType>('qa')
  const [editItem, setEditItem]       = useState<KnowledgeItem | null>(null)

  const [form, setForm] = useState({
    question: '', answer: '', category: 'כללי', audience: 'both' as 'both' | 'customer' | 'staff',
  })
  const [fileTitle,    setFileTitle]   = useState('')
  const [fileAud,      setFileAud]     = useState<'both'|'customer'|'staff'>('both')
  const [fileCat,      setFileCat]     = useState('כללי')
  const [urlInput,     setUrlInput]    = useState('')
  const [urlTitle,     setUrlTitle]    = useState('')
  const [urlAud,       setUrlAud]      = useState<'both'|'customer'|'staff'>('both')
  const [urlCat,       setUrlCat]      = useState('כללי')
  const [urlManual,    setUrlManual]   = useState('')
  const [showManual,   setShowManual]  = useState(false)
  const [saving,       setSaving]      = useState(false)
  const [msg,          setMsg]         = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    setBId(profile.business_id)

    const [{ data: kbData }, { count }] = await Promise.all([
      supabase.from('qa_knowledge').select('*')
        .eq('business_id', profile.business_id)
        .order('created_at', { ascending: false }),
      supabase.from('knowledge_gaps').select('*', { count: 'exact', head: true })
        .eq('business_id', profile.business_id).eq('status', 'open'),
    ])

    setItems((kbData || []) as KnowledgeItem[])
    setGapCount(count || 0)
    setLoading(false)
  }

  const filtered = items.filter(i => {
    if (activeOnly && !i.is_active) return false
    if (audFilter !== 'all' && i.audience !== audFilter) return false
    if (catFilter !== 'הכל' && i.category !== catFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (i.title || '').toLowerCase().includes(s) ||
             (i.question || '').toLowerCase().includes(s) ||
             (i.answer || '').toLowerCase().includes(s)
    }
    return true
  })

  function openAdd() {
    setEditItem(null)
    setForm({ question: '', answer: '', category: 'כללי', audience: 'both' })
    setFileTitle(''); setFileAud('both'); setFileCat('כללי')
    setUrlInput(''); setUrlTitle(''); setUrlAud('both'); setUrlCat('כללי')
    setMsg(''); setStep('type'); setShowModal(true)
  }

  function openEdit(item: KnowledgeItem) {
    setEditItem(item)
    setForm({ question: item.question || item.title, answer: item.answer || '', category: item.category || 'כללי', audience: item.audience || 'both' })
    setAddType(item.type)
    setStep('form'); setMsg(''); setShowModal(true)
  }

  async function saveQA() {
    if (!form.question.trim() || !form.answer.trim() || !businessId) return
    setSaving(true)
    if (editItem) {
      await supabase.from('qa_knowledge').update({
        title: form.question, question: form.question,
        answer: form.answer, category: form.category, audience: form.audience,
      }).eq('id', editItem.id)
    } else {
      await supabase.from('qa_knowledge').insert({
        business_id: businessId, type: 'qa',
        title: form.question, question: form.question,
        answer: form.answer, category: form.category,
        audience: form.audience, is_active: true,
      })
    }
    setSaving(false); setShowModal(false); loadData()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !businessId) return
    setSaving(true); setMsg('')
    const fd = new FormData()
    fd.append('file', file); fd.append('business_id', businessId)
    fd.append('title', fileTitle || file.name)
    fd.append('audience', fileAud); fd.append('category', fileCat)
    const res  = await fetch('/api/knowledge/upload', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.ok) { setShowModal(false); loadData() }
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
    if (json.ok) { setShowModal(false); loadData() }
    else if (res.status === 422 && json.error?.includes('403')) {
      setShowManual(true)
      setMsg('')
    } else {
      setMsg('שגיאה: ' + json.error)
    }
    setSaving(false)
  }

  async function handleManualSave() {
    if (!urlManual.trim() || !businessId) return
    setSaving(true); setMsg('')
    const { error } = await supabase.from('qa_knowledge').insert({
      business_id: businessId,
      type: 'url',
      title: urlTitle || urlInput,
      question: urlTitle || urlInput,
      answer: urlManual,
      content: urlManual,
      source_url: urlInput,
      category: urlCat,
      audience: urlAud,
      is_active: true,
    })
    if (error) { setMsg('שגיאה בשמירה'); setSaving(false); return }
    setShowModal(false); setShowManual(false); setUrlManual(''); loadData()
    setSaving(false)
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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--fg-3)', fontSize: '14px' }}>
      טוען מאגר ידע...
    </div>
  )

  return (
    <div style={{ padding: '28px 36px', maxWidth: '1000px', margin: '0 auto', direction: 'rtl' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>מאגר ידע</h1>
          <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: '4px 0 0' }}>
            {items.length} פריטים — המידע שהבוט לומד ממנו
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/qa/gaps')}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '9px 16px', borderRadius: '10px', cursor: 'pointer',
              border: gapCount > 0 ? '1.5px solid #FCA5A5' : '1.5px solid var(--border-default)',
              background: gapCount > 0 ? '#FEF2F2' : 'var(--bg-surface)',
              color: gapCount > 0 ? '#DC2626' : 'var(--fg-3)',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
            }}
          >
            <AlertCircle size={15} />
            פערי ידע
            {gapCount > 0 && (
              <span style={{ background: '#DC2626', color: 'white', borderRadius: '99px', padding: '1px 7px', fontSize: '11px', fontWeight: 700 }}>
                {gapCount}
              </span>
            )}
          </button>
          <button
            onClick={openAdd}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '9px 18px', borderRadius: '10px', border: 'none',
              background: 'var(--brand)', color: 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            }}
          >
            <Plus size={15} /> הוסף מידע
          </button>
        </div>
      </div>

      {/* ── Search + audience filter ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-4)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="חפש לפי שם, תוכן או קטגוריה..."
            style={{ width: '100%', padding: '9px 34px 9px 12px', borderRadius: '10px', border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--fg-1)', fontFamily: 'inherit', fontSize: '13px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'customer', 'staff', 'both'] as const).map(k => {
            const labels: Record<string, string> = { all: 'הכל', customer: '🤖 לקוחות', staff: '👥 צוות', both: '🔵 שניהם' }
            const active = audFilter === k
            return (
              <button key={k} onClick={() => setAudFilter(k)} style={{
                padding: '7px 13px', borderRadius: '8px', fontFamily: 'inherit', fontSize: '12px',
                fontWeight: active ? 600 : 400, cursor: 'pointer',
                border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border-default)'}`,
                background: active ? '#EEF2FF' : 'var(--bg-surface)',
                color: active ? '#3730A3' : 'var(--fg-3)',
              }}>{labels[k]}</button>
            )
          })}
        </div>
      </div>

      {/* ── Category pills ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCatFilter(c)} style={{
            padding: '5px 12px', borderRadius: '99px', fontFamily: 'inherit', fontSize: '12px',
            cursor: 'pointer', border: `1.5px solid ${catFilter === c ? '#6366F1' : 'var(--border-subtle)'}`,
            background: catFilter === c ? '#EEF2FF' : 'var(--bg-surface)',
            color: catFilter === c ? '#4338CA' : 'var(--fg-3)', fontWeight: catFilter === c ? 600 : 400,
          }}>{c}</button>
        ))}
      </div>

      {/* ── Controls bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '14px', gap: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--fg-2)' }}>
          <div
            onClick={() => setActiveOnly(v => !v)}
            style={{
              width: '32px', height: '18px', borderRadius: '99px', cursor: 'pointer',
              background: activeOnly ? '#6366F1' : 'var(--border-default)',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: '3px',
              right: activeOnly ? '3px' : '13px',
              width: '12px', height: '12px', borderRadius: '50%',
              background: 'white', transition: 'right 0.2s',
            }} />
          </div>
          פעילים בלבד
        </label>
        <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--fg-4)' }}>
          {filtered.length} פריטים · מיון: חדש ביותר
        </span>
      </div>

      {/* ── List ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-default)', borderRadius: '14px', color: 'var(--fg-3)' }}>
          <p style={{ fontSize: '32px', margin: '0 0 10px' }}>📭</p>
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 4px' }}>
            {search || audFilter !== 'all' || catFilter !== 'הכל' ? 'לא נמצאו פריטים' : 'המאגר ריק'}
          </p>
          <p style={{ fontSize: '13px', margin: 0 }}>
            {search ? 'נסה לחפש מילה אחרת' : 'לחץ על "הוסף מידע" כדי להתחיל'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {filtered.map(item => {
            const tm = TYPE_META[item.type] || TYPE_META.qa
            const aud = AUD[item.audience || 'both']
            return (
              <div key={item.id} style={{
                display: 'grid', gridTemplateColumns: '36px 1fr auto auto',
                alignItems: 'center', gap: '12px',
                padding: '13px 16px', borderRadius: '12px',
                border: `1px solid var(--border-subtle)`,
                borderRight: `3px solid ${aud.border}`,
                background: 'var(--bg-surface)',
                opacity: item.is_active ? 1 : 0.5,
                transition: 'all 0.15s',
              }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: tm.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0 }}>
                  {tm.icon}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title || item.question}
                    </span>
                    <span style={{ fontSize: '10px', background: 'var(--bg-hover)', color: 'var(--fg-3)', padding: '1px 7px', borderRadius: '4px', flexShrink: 0 }}>
                      {item.category}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.type === 'url' ? (item.source_url || '') : (item.answer || item.content || '')}
                  </p>
                </div>

                <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '99px', background: aud.bg, color: aud.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {aud.emoji} {aud.label}
                </span>

                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button onClick={() => toggleActive(item.id, item.is_active)} title={item.is_active ? 'השבת' : 'הפעל'}
                    style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: item.is_active ? '#DCFCE7' : 'var(--bg-hover)', color: item.is_active ? '#16A34A' : 'var(--fg-4)' }}>
                    {item.is_active ? <Check size={13} /> : <X size={13} />}
                  </button>
                  {item.type === 'qa' && (
                    <button onClick={() => openEdit(item)}
                      style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', background: 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
                      <Edit2 size={12} />
                    </button>
                  )}
                  {item.type === 'url' && item.source_url && (
                    <a href={item.source_url} target="_blank"
                      style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', textDecoration: 'none' }}>
                      <Globe size={12} />
                    </a>
                  )}
                  {item.type === 'file' && item.file_url && (
                    <a href={item.file_url} target="_blank"
                      style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', textDecoration: 'none' }}>
                      <FileText size={12} />
                    </a>
                  )}
                  <button onClick={() => deleteItem(item.id)}
                    style={{ width: '30px', height: '30px', borderRadius: '7px', border: 'none', background: 'var(--bg-hover)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setShowManual(false); setUrlManual('') } }}>
          <div style={{ background: 'var(--bg-surface)', borderRadius: '18px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)' }}>
                {editItem ? 'עריכת פריט' : step === 'type' ? 'הוסף מידע חדש' : `הוסף ${TYPE_META[addType].label}`}
              </h2>
              <button onClick={() => { setShowModal(false); setShowManual(false); setUrlManual('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '4px' }}><X size={18} /></button>
            </div>

            <div style={{ padding: '22px' }}>

              {/* Step 1 — type selector */}
              {step === 'type' && !editItem && (
                <div>
                  <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: '0 0 16px' }}>בחר את סוג המידע שתרצה להוסיף:</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {([
                      { type: 'qa' as AddType,   icon: '💬', title: 'שאלה ותשובה', sub: 'הכנס ידע בפורמט שאלה–תשובה' },
                      { type: 'file' as AddType, icon: '📄', title: 'קובץ',         sub: 'PDF, Word, Excel, TXT' },
                      { type: 'url' as AddType,  icon: '🔗', title: 'לינק',          sub: 'סרוק תוכן מאתר אינטרנט' },
                    ]).map(opt => (
                      <button key={opt.type}
                        onClick={() => { setAddType(opt.type); setStep('form') }}
                        style={{
                          padding: '18px 16px', borderRadius: '12px', border: '1.5px solid var(--border-default)',
                          background: 'var(--bg-surface)', cursor: 'pointer', textAlign: 'right',
                          transition: 'all 0.15s', fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#6366F1'; (e.currentTarget as HTMLElement).style.background = '#EEF2FF' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
                      >
                        <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>{opt.icon}</span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--fg-1)', display: 'block', marginBottom: '3px' }}>{opt.title}</span>
                        <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2 — form */}
              {(step === 'form' || editItem) && (
                <div>
                  {/* Audience selector */}
                  {!editItem && <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 8px' }}>למי מיועד המידע?</p>}
                  {editItem && <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', margin: '0 0 8px' }}>קהל יעד</p>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '18px' }}>
                    {(['both', 'customer', 'staff'] as const).map(a => {
                      const A = AUD[a]
                      const curAud = addType === 'file' ? fileAud : addType === 'url' ? urlAud : form.audience
                      const sel = curAud === a
                      return (
                        <button key={a} onClick={() => {
                          if (addType === 'qa') setForm(f => ({ ...f, audience: a }))
                          else if (addType === 'file') setFileAud(a)
                          else setUrlAud(a)
                        }} style={{
                          padding: '10px 8px', borderRadius: '10px', border: `2px solid ${sel ? A.border : 'var(--border-subtle)'}`,
                          background: sel ? A.bg : 'var(--bg-surface)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                        }}>
                          <span style={{ fontSize: '18px', display: 'block', marginBottom: '3px' }}>{A.emoji}</span>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: sel ? A.color : 'var(--fg-3)' }}>{A.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Category */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={lbl}>קטגוריה</label>
                    <select
                      value={addType === 'file' ? fileCat : addType === 'url' ? urlCat : form.category}
                      onChange={e => {
                        if (addType === 'qa') setForm(f => ({ ...f, category: e.target.value }))
                        else if (addType === 'file') setFileCat(e.target.value)
                        else setUrlCat(e.target.value)
                      }}
                      className="input-base" style={{ width: '100%' }}
                    >
                      {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* Q&A fields */}
                  {addType === 'qa' && (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={lbl}>שאלה / כותרת</label>
                        <input value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                          placeholder="לדוגמה: כמה עולה השתלת שיניים?" className="input-base" style={{ width: '100%' }} />
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={lbl}>
                          תשובה
                          {form.audience === 'staff' && <span style={{ marginRight: '6px', fontSize: '10px', color: '#7C3AED', fontWeight: 400 }}>יכולה לכלול מידע פנימי</span>}
                        </label>
                        <textarea value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
                          rows={5} className="input-base" style={{ width: '100%', resize: 'vertical' }}
                          placeholder={form.audience === 'staff' ? 'עד 12% הנחה ללא אישור. מעל — מנהל מכירות.' : 'כתוב את התשובה שהבוט ייתן ללקוח...'} />
                      </div>
                    </>
                  )}

                  {/* File upload */}
                  {addType === 'file' && (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={lbl}>כותרת (אופציונלי)</label>
                        <input value={fileTitle} onChange={e => setFileTitle(e.target.value)}
                          placeholder="לדוגמה: מחירון 2026" className="input-base" style={{ width: '100%' }} />
                      </div>
                      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" onChange={handleFile} style={{ display: 'none' }} />
                      <button onClick={() => fileRef.current?.click()} disabled={saving} style={{
                        width: '100%', padding: '28px', borderRadius: '12px', border: '2px dashed var(--border-default)',
                        background: 'var(--bg-sunken)', cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--fg-3)',
                      }}>
                        <Upload size={24} style={{ color: 'var(--fg-4)' }} />
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{saving ? 'מעלה...' : 'בחר קובץ להעלאה'}</span>
                        <span style={{ fontSize: '11px' }}>PDF, Word, Excel, TXT</span>
                      </button>
                    </>
                  )}

                  {/* URL scrape */}
                  {addType === 'url' && !showManual && (
                    <>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={lbl}>כותרת (אופציונלי)</label>
                        <input value={urlTitle} onChange={e => setUrlTitle(e.target.value)}
                          placeholder="לדוגמה: עמוד אודות" className="input-base" style={{ width: '100%' }} />
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={lbl}>כתובת URL</label>
                        <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                          placeholder="https://..." className="input-base" style={{ width: '100%' }} dir="ltr"
                          onKeyDown={e => e.key === 'Enter' && handleScrape()} />
                      </div>
                    </>
                  )}

                  {/* Manual paste fallback (after 403) */}
                  {addType === 'url' && showManual && (
                    <>
                      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
                        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '13px', color: '#92400E' }}>האתר חוסם גישה אוטומטית</p>
                        <p style={{ margin: 0, fontSize: '12px', color: '#B45309', lineHeight: 1.5 }}>
                          הכנס לדף <a href={urlInput} target="_blank" rel="noreferrer" style={{ color: '#7C3AED', fontWeight: 600 }} dir="ltr">{urlInput}</a>, העתק את הטקסט והדבק כאן:
                        </p>
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <label style={lbl}>טקסט מהאתר</label>
                        <textarea value={urlManual} onChange={e => setUrlManual(e.target.value)}
                          rows={7} className="input-base" style={{ width: '100%', resize: 'vertical' }}
                          placeholder="הדבק כאן את הטקסט מהעמוד..." />
                      </div>
                    </>
                  )}

                  {msg && <p style={{ fontSize: '12px', color: msg.includes('שגיאה') ? '#EF4444' : '#10B981', margin: '8px 0 0', fontWeight: 600 }}>{msg}</p>}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                    {!editItem && step === 'form' && (
                      <button onClick={() => setStep('type')} className="btn-ghost" style={{ marginRight: 'auto' }}>חזור</button>
                    )}
                    <button onClick={() => { setShowModal(false); setShowManual(false); setUrlManual('') }} className="btn-ghost">ביטול</button>
                    {addType === 'qa' && (
                      <button onClick={saveQA} disabled={saving || !form.question.trim() || !form.answer.trim()} className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }}>
                        {saving ? 'שומר...' : editItem ? 'עדכן' : 'שמור'}
                      </button>
                    )}
                    {addType === 'url' && !showManual && (
                      <button onClick={handleScrape} disabled={saving || !urlInput.trim()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: saving ? 0.6 : 1 }}>
                        <Link2 size={13} />{saving ? 'סורק...' : 'סרוק עמוד'}
                      </button>
                    )}
                    {addType === 'url' && showManual && (
                      <button onClick={handleManualSave} disabled={saving || !urlManual.trim()} className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }}>
                        {saving ? 'שומר...' : 'שמור טקסט'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: '6px',
}
