'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { STATUS_CONFIG, SOURCE_LABELS, getDisplayName, getLeadNumber, type Lead } from '@/types'
import InteractionModal from '@/components/InteractionModal'
import { useConfirm } from '@/hooks/useConfirm'
import {
  ArrowRight, MessageCircle, Clock, FileText, Sparkles,
  CheckCircle2, XCircle, RefreshCw, PhoneOff, PartyPopper,
  Paperclip, Edit2, Save, X, Trash2, RotateCcw, Upload, Download,
} from 'lucide-react'
import Link from 'next/link'

function formatPhone(phone: string): string {
  if (!phone) return '—'
  const clean = phone.replace(/\D/g, '')
  if (clean.startsWith('972') && clean.length >= 12) {
    const local = '0' + clean.slice(3)
    return local.slice(0, 3) + '-' + local.slice(3, 6) + '-' + local.slice(6)
  }
  if (clean.startsWith('0') && clean.length === 10)
    return clean.slice(0, 3) + '-' + clean.slice(3, 6) + '-' + clean.slice(6)
  return phone
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface LeadFile {
  id: string
  file_name: string
  file_url: string
  file_size: number
  file_type: string
  created_at: string
}

const OUTCOME_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  interested:     { icon: CheckCircle2, color: '#10B981', label: 'מעוניין' },
  not_interested: { icon: XCircle,      color: '#EF4444', label: 'לא מעוניין' },
  follow_up:      { icon: RefreshCw,    color: '#3B82F6', label: 'לחזור' },
  no_answer:      { icon: PhoneOff,     color: '#9CA3AF', label: 'לא ענה' },
  published:      { icon: PartyPopper,  color: '#10B981', label: 'פרסם!' },
}

const STATUS_OPTIONS = [
  { value: 'new',          label: 'ליד חדש' },
  { value: 'contacted',    label: 'אין מענה' },
  { value: 'in_progress',  label: 'בתהליך' },
  { value: 'published',    label: 'נקבע תור' },
  { value: 'not_relevant', label: 'לא רלוונטי' },
  { value: 'no_show',      label: 'לא הגיע' },
  { value: 'arrived',      label: 'הגיע' },
]

const inp: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: '7px',
  border: '1px solid var(--border-default)', background: 'var(--bg-surface)',
  color: 'var(--fg-1)', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
}

export default function LeadDetail({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const supabase = createClient()
  const { confirm, ConfirmDialog } = useConfirm()

  const [lead, setLead] = useState<Lead | null>(null)
  const [profiles, setProfiles] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [files, setFiles] = useState<LeadFile[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingActivity, setEditingActivity] = useState<{ id: string; type: string; details: string | null; outcome: string | null } | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'files'>('details')
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [analyzingAI, setAnalyzingAI] = useState(false)
  const [deletingLead, setDeletingLead] = useState(false)
  const [services, setServices] = useState<{ name: string }[]>([])

  const load = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', authUser?.id || '').single()
    const bId = profile?.business_id || null
    setBusinessId(bId)

    const [{ data: leadData }, { data: profilesData }, { data: activitiesData }, { data: filesData }, { data: bizData }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('profiles').select('*').eq('business_id', bId),
      supabase.from('lead_activities').select('*, profile:profiles(full_name)').eq('lead_id', leadId).order('created_at', { ascending: false }),
      supabase.from('lead_files').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
      supabase.from('businesses').select('settings').eq('id', bId || '').single(),
    ])
    setLead(leadData)
    setProfiles(profilesData || [])
    setActivities(activitiesData || [])
    setFiles(filesData || [])
    // "סיבת פנייה" ידנית נבחרת רק מתוך השירותים המוגדרים בעסק — אותו עיקרון
    // כמו matchServiceReason בבוט (src/lib/botTags.ts), כדי שלא תיכתב סיבה
    // חופשית שלא תואמת אף שירות אמיתי
    setServices(((bizData?.settings as any)?.services || []).filter((s: any) => s.active !== false))

    if (leadData && !leadData.first_opened_at) {
      await supabase.from('leads').update({ first_opened_at: new Date().toISOString() }).eq('id', leadId)
    }
    setLoading(false)
  }, [leadId])

  async function uploadFile(file: File) {
    if (!lead) return
    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${lead.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('lead-files').upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('lead-files').getPublicUrl(path)
      const { data: inserted, error: insErr } = await supabase.from('lead_files').insert({
        lead_id: lead.id, business_id: businessId,
        file_name: file.name, file_url: publicUrl,
        file_size: file.size, file_type: file.type,
      }).select().single()
      if (insErr) throw insErr
      if (inserted) setFiles(prev => [inserted as LeadFile, ...prev])
    } catch {
      alert('שגיאה בהעלאת קובץ')
    } finally {
      setUploadingFile(false)
    }
  }

  async function deleteFile(fileId: string) {
    if (!(await confirm('למחוק את הקובץ הזה?'))) return
    await supabase.from('lead_files').delete().eq('id', fileId)
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (!lead) return
    setEditData({
      first_name:  (lead as any).first_name || '',
      last_name:   (lead as any).last_name  || '',
      phone:       lead.phone || '',
      email:       (lead as any).email || '',
      status:      lead.status || 'new',
      notes:       (lead as any).notes || '',
      assigned_to: (lead as any).assigned_to || '',
      treatment_type: lead.treatment_type || '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    if (!lead) return
    setSaving(true)
    const update: Record<string, any> = {
      first_name:  editData.first_name || null,
      last_name:   editData.last_name  || null,
      phone:       editData.phone      || null,
      email:       editData.email      || null,
      status:      editData.status,
      notes:       editData.notes      || null,
      assigned_to: editData.assigned_to || null,
      treatment_type: editData.treatment_type || null,
    }
    // אם סיבת הפנייה שונתה ידנית — נועלים אותה כדי שהבוט לא ידרוס בהמשך השיחה
    if (update.treatment_type !== (lead.treatment_type || null)) {
      update.treatment_type_locked = true
    }
    // ליד "פורסם" (תור נקבע) או "לא רלוונטי" לא צריך תזכורת פתוחה שגוררת
    // מפעם קודמת — אותה הבחנה שכבר קיימת בבאנר התזכורת של הכרטיס עצמו
    if (update.status === 'published' || update.status === 'not_relevant') {
      update.next_followup = null
    }
    // keep name in sync for leads that have a single "name" field
    if (editData.first_name || editData.last_name) {
      update.name = [editData.first_name, editData.last_name].filter(Boolean).join(' ')
    }
    const { error } = await supabase.from('leads').update(update).eq('id', lead.id)
    // "ממתין לנציג" יושב על השיחה, לא על הליד — אם הליד סומן כטופל, אין
    // סיבה שהדגל יישאר תקוע. מחפש לפי bot_enabled=false או escalated_at
    // קיים (שני המקרים הנפרדים שגורמים ל"ממתין לנציג")
    if (!error && (update.status === 'published' || update.status === 'not_relevant')) {
      const { data: conv } = await supabase
        .from('conversations').select('id').eq('lead_id', lead.id)
        .or('bot_enabled.eq.false,escalated_at.not.is.null').maybeSingle()
      if (conv) {
        await supabase.from('conversations')
          .update({ bot_enabled: true, status: 'active', escalated_at: null, escalation_reason: null })
          .eq('id', conv.id)
      }
    }
    if (!error) {
      setLead(prev => prev ? { ...prev, ...update } as any : prev)
      setEditing(false)
    }
    setSaving(false)
  }

  async function deleteActivity(activityId: string) {
    if (!(await confirm('למחוק את האינטראקציה הזו?'))) return
    await supabase.from('lead_activities').delete().eq('id', activityId)
    setActivities(prev => prev.filter(a => a.id !== activityId))
  }

  // מוחק את הליד — קודם קבצים/אינטראקציות משויכות (בלי תלות בכללי CASCADE
  // שאולי לא מוגדרים ב-DB), ורק אז את הליד עצמו, ואז חוזר לרשימה
  // מחיקה רכה — הליד עובר לסל מחזור (deleted_at), אפשר לשחזר אותו משם
  async function deleteLead() {
    if (!lead) return
    if (!(await confirm(`להעביר את הליד של ${getDisplayName(lead)} לסל מחזור?`))) return
    setDeletingLead(true)
    const { error } = await supabase.from('leads').update({ deleted_at: new Date().toISOString() }).eq('id', lead.id)
    setDeletingLead(false)
    if (error) { alert('המחיקה נכשלה: ' + error.message); return }
    onClose()
  }

  async function refreshAI() {
    if (!lead) return
    setAnalyzingAI(true)
    try {
      const res = await fetch('/api/leads/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const data = await res.json()
      if (data.summary || data.recommendation) {
        setLead(prev => prev ? { ...prev, ai_summary: data.summary, ai_recommendation: data.recommendation } as any : prev)
      }
    } finally {
      setAnalyzingAI(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
      <p style={{ color: 'var(--fg-4)', fontSize: '13px' }}>טוען...</p>
    </div>
  )

  if (!lead) return <div style={{ padding: '24px', color: 'var(--fg-4)' }}>ליד לא נמצא</div>

  const status = STATUS_CONFIG[lead.status]
  const displayName = getDisplayName(lead)
  const leadNum = getLeadNumber(lead)

  const TABS = [
    { key: 'details', label: 'פרטים', icon: FileText },
    { key: 'files',   label: 'קבצים', icon: Paperclip },
  ] as const

  return (
    <div style={{ padding: '24px', direction: 'rtl' }}>

      {/* Breadcrumb — כאן סוגר את החלון הקופץ וחוזר לרשימה, לא ניווט לעמוד */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--fg-4)', marginBottom: '18px' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--fg-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', padding: 0 }}>
          <ArrowRight size={13} /> לידים
        </button>
        <span>/</span>
        <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{displayName}</span>
        <span style={{ color: 'var(--fg-4)' }}>#{leadNum}</span>
      </div>

      {/* ─── Hero card ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '50px', height: '50px', borderRadius: '14px', flexShrink: 0,
              background: 'var(--brand-soft)', color: 'var(--brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px', fontWeight: 700,
            }}>
              {displayName.charAt(0)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' }}>
                <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>{displayName}</h1>
                <span className={`status-${lead.status}`} style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px' }}>
                  {status.label}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '12px', color: 'var(--fg-3)' }}>
                {lead.phone && <span dir="ltr">{formatPhone(lead.phone)}</span>}
                <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                {(lead as any).email && <span dir="ltr">{(lead as any).email}</span>}
                <span style={{ color: 'var(--fg-4)' }}>{new Date(lead.created_at).toLocaleDateString('he-IL')}</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {lead.phone && (
              <Link href={`/conversations?lead_id=${lead.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '9px', background: '#EBFBF4', color: '#0F9E7B', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>
                <MessageCircle size={13} /> שיחה
              </Link>
            )}
            {!editing ? (
              <button onClick={startEdit} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '9px', background: 'var(--bg-sunken)', color: 'var(--fg-2)', fontSize: '12px', fontWeight: 600, border: '1px solid var(--border-default)', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Edit2 size={13} /> ערוך
              </button>
            ) : (
              <>
                <button onClick={() => setEditing(false)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '9px', background: 'var(--bg-sunken)', color: 'var(--fg-3)', fontSize: '12px', fontWeight: 600, border: '1px solid var(--border-default)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <X size={13} /> ביטול
                </button>
                <button onClick={saveEdit} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '9px', background: 'var(--brand)', color: 'white', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
                  <Save size={13} /> {saving ? 'שומר...' : 'שמור'}
                </button>
              </>
            )}
            <button onClick={() => setShowModal(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '7px 14px' }}>
              <FileText size={13} /> תעד אינטראקציה
            </button>
            <button onClick={deleteLead} disabled={deletingLead}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '9px', background: '#FEF2F2', color: '#DC2626', fontSize: '12px', fontWeight: 600, border: '1px solid #FCA5A5', cursor: deletingLead ? 'default' : 'pointer', fontFamily: 'inherit', opacity: deletingLead ? 0.6 : 1 }}>
              <Trash2 size={13} /> {deletingLead ? 'מוחק...' : 'מחק ליד'}
            </button>
          </div>
        </div>

        {lead.next_followup && !['published', 'not_relevant'].includes(lead.status) && (() => {
          const isOverdue = new Date(lead.next_followup) < new Date()
          return (
            <div style={{ marginTop: '12px', background: isOverdue ? 'var(--danger-soft)' : 'var(--brand-soft)', border: `1px solid ${isOverdue ? 'var(--danger-border)' : 'var(--blue-100)'}`, borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '7px', color: isOverdue ? 'var(--danger)' : 'var(--brand)', fontSize: '12px', fontWeight: 600 }}>
              <Clock size={12} />
              {isOverdue ? `Follow-up היה אמור ב-${new Date(lead.next_followup).toLocaleDateString('he-IL')}` : `Follow-up הבא: ${new Date(lead.next_followup).toLocaleDateString('he-IL')}`}
            </div>
          )
        })()}
      </div>

      {/* ─── AI Insights bar ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '14px', padding: '14px 18px', background: 'var(--info-soft)', border: '1px solid var(--info-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={13} style={{ color: 'var(--info)' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--info)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>תובנות AI</span>
          </div>
          <button onClick={refreshAI} disabled={analyzingAI}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, opacity: analyzingAI ? 0.6 : 1 }}>
            <RotateCcw size={11} style={{ animation: analyzingAI ? 'spin 1s linear infinite' : 'none' }} />
            {analyzingAI ? 'מנתח...' : 'רענן'}
          </button>
        </div>
        {(lead as any).ai_summary || (lead as any).ai_recommendation ? (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {(lead as any).ai_summary && (
              <p style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6, margin: 0, flex: 1 }}>{(lead as any).ai_summary}</p>
            )}
            {(lead as any).ai_recommendation && (
              <p style={{ fontSize: '13px', color: 'var(--info)', lineHeight: 1.6, fontWeight: 600, margin: 0, flex: 1 }}>💡 {(lead as any).ai_recommendation}</p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', margin: 0 }}>לחץ "רענן" לקבלת תובנות על הליד</p>
        )}
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)' }}>
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '12px 20px', border: 'none', cursor: 'pointer',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--brand)' : 'var(--fg-3)',
                  fontFamily: 'inherit', fontSize: '13px', fontWeight: isActive ? 600 : 400,
                  borderBottom: isActive ? '2px solid var(--brand)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}>
                <Icon size={14} /> {tab.label}
              </button>
            )
          })}
        </div>

        {/* ── Tab: פרטים ─────────────────────────────────────────────────── */}
        {activeTab === 'details' && (
          <div style={{ padding: '20px 24px' }}>
            {editing ? (
              /* ── Edit mode ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>שם פרטי</p>
                    <input style={inp} value={editData.first_name} onChange={e => setEditData(d => ({ ...d, first_name: e.target.value }))} placeholder="שם פרטי" />
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>שם משפחה</p>
                    <input style={inp} value={editData.last_name} onChange={e => setEditData(d => ({ ...d, last_name: e.target.value }))} placeholder="שם משפחה" />
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>טלפון</p>
                    <input style={inp} dir="ltr" value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} placeholder="050-0000000" />
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>אימייל</p>
                    <input style={inp} dir="ltr" value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} placeholder="email@example.com" />
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>סטטוס</p>
                    <select style={{ ...inp, cursor: 'pointer' }} value={editData.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))}>
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>נציג</p>
                    <select style={{ ...inp, cursor: 'pointer' }} value={editData.assigned_to} onChange={e => setEditData(d => ({ ...d, assigned_to: e.target.value }))}>
                      <option value="">— לא שויך —</option>
                      {profiles.map((p: any) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                    </select>
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>סיבת פנייה</p>
                    <select style={{ ...inp, cursor: 'pointer' }} value={editData.treatment_type} onChange={e => setEditData(d => ({ ...d, treatment_type: e.target.value }))}>
                      <option value="">— בחר —</option>
                      {services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                      <option value="אחר">אחר</option>
                      {editData.treatment_type && !services.some(s => s.name === editData.treatment_type) && editData.treatment_type !== 'אחר' && (
                        <option value={editData.treatment_type}>{editData.treatment_type}</option>
                      )}
                    </select>
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>הערות</p>
                  <textarea style={{ ...inp, resize: 'vertical', minHeight: '72px' }} value={editData.notes} onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))} placeholder="הערות חופשיות..." />
                </div>
              </div>
            ) : (
              /* ── View mode ── */
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                  {[
                    { label: 'שם פרטי',  value: (lead as any).first_name },
                    { label: 'שם משפחה', value: (lead as any).last_name },
                    { label: 'טלפון',    value: lead.phone ? formatPhone(lead.phone) : null, dir: 'ltr' as const },
                    { label: 'אימייל',   value: (lead as any).email, dir: 'ltr' as const },
                    { label: 'סטטוס',    value: status.label },
                    { label: 'סיבת פנייה', value: lead.treatment_type },
                    { label: 'מקור',     value: SOURCE_LABELS[lead.source] || lead.source },
                    { label: 'נציג',     value: profiles.find((p: any) => p.id === (lead as any).assigned_to)?.full_name },
                    { label: 'נוצר',     value: new Date(lead.created_at).toLocaleDateString('he-IL') },
                  ].filter(f => f.value).map(({ label, value, dir }) => (
                    <div key={label}>
                      <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '3px' }}>{label}</p>
                      <p style={{ fontSize: '13px', color: 'var(--fg-1)', fontWeight: 500, margin: 0 }} dir={dir}>{value}</p>
                    </div>
                  ))}
                </div>

                {(lead as any).notes && (
                  <div style={{ background: 'var(--bg-sunken)', borderRadius: '8px', padding: '12px 14px', marginBottom: '20px' }}>
                    <p style={{ fontSize: '10px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>הערות</p>
                    <p style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.7, margin: 0 }}>{(lead as any).notes}</p>
                  </div>
                )}
              </>
            )}

            {/* Activity timeline */}
            {activities.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>תיעוד אינטראקציות</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activities.map(a => {
                    const outcomeConf = a.outcome ? OUTCOME_CONFIG[a.outcome] : null
                    const OutcomeIcon = outcomeConf?.icon
                    return (
                      <div key={a.id} style={{ display: 'flex', gap: '10px', padding: '10px 12px', background: 'var(--bg-sunken)', borderRadius: '8px', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-1)' }}>{a.action}</span>
                            {outcomeConf && OutcomeIcon && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 700, color: outcomeConf.color }}>
                                <OutcomeIcon size={10} /> {outcomeConf.label}
                              </span>
                            )}
                          </div>
                          {a.details && <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: 0, lineHeight: 1.5 }}>{a.details}</p>}
                          <p style={{ fontSize: '10px', color: 'var(--fg-4)', margin: '3px 0 0' }}>
                            {a.profile?.full_name && `${a.profile.full_name} · `}
                            {fmtDate(a.created_at)}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                          <button onClick={() => setEditingActivity({ id: a.id, type: a.type, details: a.details, outcome: a.outcome })}
                            title="ערוך אינטראקציה"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', padding: '2px', display: 'flex', borderRadius: '5px', transition: 'color 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--brand)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-4)')}>
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => deleteActivity(a.id)}
                            title="מחק אינטראקציה"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', padding: '2px', display: 'flex', borderRadius: '5px', transition: 'color 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--fg-4)')}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {activities.length === 0 && !editing && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--fg-4)' }}>
                <Clock size={24} style={{ margin: '0 auto 8px', display: 'block', color: 'var(--fg-4)' }} />
                <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-3)', margin: '0 0 6px' }}>אין תיעוד עדיין</p>
                <button onClick={() => setShowModal(true)} style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  + תעד ראשון
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: קבצים ─────────────────────────────────────────────────── */}
        {activeTab === 'files' && (
          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
                borderRadius: '9px', border: '1.5px dashed var(--border-default)',
                background: 'var(--bg-sunken)', color: 'var(--fg-2)', fontSize: '12px', fontWeight: 600,
                cursor: uploadingFile ? 'default' : 'pointer', opacity: uploadingFile ? 0.6 : 1,
              }}>
                <Upload size={13} /> {uploadingFile ? 'מעלה...' : 'העלה קובץ'}
                <input type="file" style={{ display: 'none' }} disabled={uploadingFile}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
              </label>
            </div>

            {files.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <Paperclip size={28} style={{ margin: '0 auto 10px', display: 'block', color: 'var(--fg-4)' }} />
                <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: 0 }}>
                  אין עדיין קבצים — קבצים שהלקוח שולח בוואטסאפ יופיעו כאן אוטומטית, או העלה ידנית
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                {files.map(f => {
                  const isImage = f.file_type?.startsWith('image/')
                  return (
                    <div key={f.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: '10px', overflow: 'hidden', background: 'var(--bg-sunken)' }}>
                      <a href={f.file_url} target="_blank" rel="noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.file_url} alt={f.file_name} style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block', background: 'var(--bg-hover)' }} />
                        ) : (
                          <div style={{ width: '100%', height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)' }}>
                            <FileText size={30} style={{ color: 'var(--fg-4)' }} />
                          </div>
                        )}
                      </a>
                      <div style={{ padding: '8px 10px' }}>
                        <p title={f.file_name} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-1)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '10px', color: 'var(--fg-4)' }}>{fmtSize(f.file_size)}</span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <a href={f.file_url} target="_blank" rel="noreferrer" title="הורד" style={{ color: 'var(--fg-4)', display: 'flex' }}>
                              <Download size={12} />
                            </a>
                            <button onClick={() => deleteFile(f.id)} title="מחק" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', display: 'flex', padding: 0 }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && lead && (
        <InteractionModal
          leadId={lead.id}
          leadName={displayName}
          leadNotes={(lead as any).notes}
          onClose={() => setShowModal(false)}
          onSaved={() => { load(); setShowModal(false) }}
        />
      )}

      {editingActivity && lead && (
        <InteractionModal
          leadId={lead.id}
          leadName={displayName}
          editActivity={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => { load(); setEditingActivity(null) }}
        />
      )}

      {ConfirmDialog}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
