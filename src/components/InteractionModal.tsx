'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Sparkles, Phone, MessageCircle, FileText, Loader2, Save } from 'lucide-react'

// צבעים לפי טוקני העיצוב של האתר (לא Tailwind קשיח) — כדי שיתאימו גם למצב כהה
const TYPES = [
  { value: 'call',     label: 'שיחה',    icon: Phone,         bg: 'var(--brand-soft)',   fg: 'var(--blue-700)', border: 'var(--blue-100)' },
  { value: 'whatsapp', label: 'וואטסאפ', icon: MessageCircle, bg: 'var(--success-soft)', fg: 'var(--success)',  border: 'var(--success-border)' },
  { value: 'note',     label: 'הערה',    icon: FileText,      bg: 'var(--info-soft)',    fg: 'var(--info)',     border: 'var(--info-border)' },
]

const OUTCOMES = [
  { value: 'interested',     emoji: '✅', label: 'מעוניין',      bg: 'var(--success-soft)', fg: 'var(--success)', border: 'var(--success-border)' },
  { value: 'not_interested', emoji: '❌', label: 'לא מעוניין',   bg: 'var(--danger-soft)',  fg: 'var(--danger)',  border: 'var(--danger-border)' },
  { value: 'follow_up',      emoji: '🔄', label: 'לחזור',        bg: 'var(--brand-soft)',   fg: 'var(--brand)',   border: 'var(--blue-100)' },
  { value: 'no_answer',      emoji: '📵', label: 'לא ענה',       bg: 'var(--bg-sunken)',    fg: 'var(--fg-3)',    border: 'var(--border-default)' },
]

const label: React.CSSProperties = {
  display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--fg-4)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '7px',
}

const pill = (active: boolean, bg: string, fg: string, border: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '5px',
  padding: '6px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer', transition: 'all 140ms',
  background: active ? bg : 'var(--bg-sunken)',
  color: active ? fg : 'var(--fg-3)',
  border: `1px solid ${active ? border : 'var(--border-default)'}`,
})

interface EditActivity {
  id: string
  type: string
  details: string | null
  outcome: string | null
}

interface Props {
  leadId: string
  leadName: string
  leadNotes?: string | null
  onClose: () => void
  onSaved: () => void
  // כשקיים — עורכים אינטראקציה קיימת (UPDATE) במקום ליצור חדשה (INSERT)
  editActivity?: EditActivity
}

export default function InteractionModal({ leadId, leadName, leadNotes, onClose, onSaved, editActivity }: Props) {
  const supabase = createClient()
  const isEdit = !!editActivity
  const [type, setType] = useState(editActivity?.type || 'call')
  // בעריכה, הטקסט הקיים נכנס ישר לתיבה הראשית — אין הבחנה שמורה ברשומה
  // הקיימת בין "הערה גולמית" ל"סיכום AI שנוסח", רק שדה `details` אחד
  const [notes, setNotes] = useState(editActivity?.details || '')
  const [outcome, setOutcome] = useState(editActivity?.outcome || '')
  const [aiSummary, setAiSummary] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // ברירת מחדל: בלי תזכורת. בעבר זה נקבע אוטומטית ל-3 ימים קדימה בכל תיעוד
  // אינטראקציה, גם כשהתוצאה הייתה "לא מעוניין" — מה שיצר תזכורות-רפאים
  // שאין להן כיסוי אמיתי ומציפות את הרשימה. עכשיו זו בחירה מודעת של הנציג
  const [nextFollowup, setNextFollowup] = useState('')

  async function generateSummary() {
    if (!notes) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'summary', data: { name: leadName, notes, outcome } }),
      })
      const { text } = await res.json()
      setAiSummary(text)
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const finalNotes = aiSummary || notes

    const typeLabels: Record<string, string> = { call: 'שיחה', whatsapp: 'הודעת וואטסאפ', note: 'הערה' }
    const action = `${typeLabels[type]} עם ${leadName}`

    // עריכת אינטראקציה קיימת — רק מעדכנים את הרשומה עצמה. לא נוגעים שוב
    // ב-status/next_followup/last_contacted של הליד: אלה תופעות לוואי
    // חד-פעמיות שכבר קרו כשהאינטראקציה נוצרה לראשונה, ולא רצוי "להפעיל"
    // אותן שוב סתם כי מישהו תיקן טעות הקלדה בטקסט
    if (editActivity) {
      const { error } = await supabase.from('lead_activities').update({
        type, action, details: finalNotes, outcome: outcome || null,
      }).eq('id', editActivity.id)
      setSaving(false)
      if (error) { alert('עדכון האינטראקציה נכשל: ' + error.message); return }
      onSaved()
      onClose()
      return
    }

    await Promise.all([
      supabase.from('lead_activities').insert({
        lead_id: leadId,
        user_id: user!.id,
        type,
        action,
        details: finalNotes,
        outcome,
      }),
      supabase.from('leads').update({
        last_contacted: new Date().toISOString(),
        // ליד "לא מעוניין" לא אמור לגרור תזכורת פתוחה מפעם קודמת —
        // תזכורת על ליד סגור היא בדיוק הרעש שהמזכירה התלוננה עליו
        next_followup: outcome === 'not_interested' ? null : (nextFollowup || null),
        ...(outcome === 'published'      ? { status: 'published' }                            : {}),
        ...(outcome === 'interested'     ? { status: 'in_progress' }                          : {}),
        ...(outcome === 'not_interested' ? { status: 'not_relevant', temperature: 'cold' }    : {}),
      }).eq('id', leadId),
    ])

    // "ממתין לנציג" (escalated_at) יושב על השיחה, לא על הליד — ליד שסומן
    // "פורסם"/"לא מעוניין" כבר טופל, אז אין סיבה שהדגל האדום יישאר תקוע
    if (outcome === 'published' || outcome === 'not_interested') {
      const { data: conv } = await supabase
        .from('conversations').select('id').eq('lead_id', leadId).not('escalated_at', 'is', null).maybeSingle()
      if (conv) {
        await supabase.from('conversations')
          .update({ bot_enabled: true, status: 'active', escalated_at: null, escalation_reason: null })
          .eq('id', conv.id)
      }
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', direction: 'rtl' }}
    >
      <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', width: '420px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--fg-1)' }}>{isEdit ? 'עריכת אינטראקציה' : 'תיעוד אינטראקציה'}</h3>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--fg-4)' }}>עם {leadName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: '2px', display: 'flex' }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Type */}
          <div>
            <label style={label}>סוג אינטראקציה</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {TYPES.map(({ value, label: l, icon: Icon, bg, fg, border }) => (
                <button key={value} onClick={() => setType(value)} style={pill(type === value, bg, fg, border)}>
                  <Icon size={12} />
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={label}>מה קרה?</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="input-base"
              style={{ resize: 'vertical' }}
              placeholder="תאר בקצרה את השיחה, מה אמר, מה ביקש..."
            />
            {notes.length > 10 && (
              <button
                onClick={generateSummary}
                disabled={aiLoading}
                style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: aiLoading ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 500, opacity: aiLoading ? 0.6 : 1, padding: 0 }}
              >
                {aiLoading ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--fg-3)' }} /> : <Sparkles size={12} style={{ color: 'var(--info)' }} />}
                <span style={{ color: 'var(--info)' }}>{aiLoading ? 'מנסח...' : 'נסח לי סיכום מקצועי עם AI'}</span>
              </button>
            )}
          </div>

          {/* AI Summary */}
          {aiSummary && (
            <div className="animate-slide-up" style={{ borderRadius: '10px', padding: '12px 14px', background: 'var(--info-soft)', border: '1px solid var(--info-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Sparkles size={11} style={{ color: 'var(--info)' }} />
                <p style={{ margin: 0, fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--info)' }}>סיכום AI</p>
              </div>
              <textarea
                value={aiSummary}
                onChange={e => setAiSummary(e.target.value)}
                rows={3}
                style={{ width: '100%', fontSize: '13px', background: 'transparent', resize: 'vertical', outline: 'none', border: 'none', color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', padding: 0 }}
              />
            </div>
          )}

          {/* Outcome */}
          <div>
            <label style={label}>תוצאה</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {OUTCOMES.map(({ value, emoji, label: l, bg, fg, border }) => (
                <button key={value} onClick={() => setOutcome(value)} style={pill(outcome === value, bg, fg, border)}>
                  <span>{emoji}</span>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Next follow-up — לא רלוונטי בעריכת אינטראקציה קיימת, רק ביצירה חדשה.
              אופציונלי במפורש: ברירת המחדל היא בלי תזכורת בכלל */}
          {!isEdit && (
            <div>
              <label style={label}>תזכורת למעקב הבא <span style={{ fontWeight: 400, opacity: 0.6 }}>(לא חובה)</span></label>
              <input
                type="date"
                value={nextFollowup}
                onChange={e => setNextFollowup(e.target.value)}
                className="input-base"
                style={{ width: '100%' }}
              />
              {!nextFollowup && (
                <p style={{ fontSize: '11px', color: 'var(--fg-4)', margin: '4px 2px 0' }}>
                  לא תיקבע תזכורת אלא אם תבחר תאריך
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '8px', padding: '4px 22px 20px' }}>
          <button onClick={handleSave} disabled={saving || !notes.trim()} className="btn-primary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', opacity: saving || !notes.trim() ? 0.4 : 1 }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'שומר...' : isEdit ? 'שמור שינויים' : 'שמור אינטראקציה'}
          </button>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0 20px' }}>ביטול</button>
        </div>
      </div>
    </div>
  )
}
