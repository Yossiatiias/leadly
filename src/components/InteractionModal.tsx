'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Sparkles, Phone, MessageCircle, FileText, Loader2 } from 'lucide-react'

const TYPES = [
  { value: 'call', label: 'שיחה', icon: Phone, color: 'bg-green-50 text-green-600 border-green-200' },
  { value: 'whatsapp', label: 'וואטסאפ', icon: MessageCircle, color: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  { value: 'note', label: 'הערה', icon: FileText, color: 'bg-blue-50 text-blue-600 border-blue-200' },
]

const OUTCOMES = [
  { value: 'interested', label: '✅ מעוניין' },
  { value: 'not_interested', label: '❌ לא מעוניין' },
  { value: 'follow_up', label: '🔄 לחזור' },
  { value: 'no_answer', label: '📵 לא ענה' },
  { value: 'published', label: '🎉 פרסם!' },
]

interface Props {
  leadId: string
  leadName: string
  leadNotes?: string | null
  onClose: () => void
  onSaved: () => void
}

export default function InteractionModal({ leadId, leadName, leadNotes, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [type, setType] = useState('call')
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState('')
  const [aiSummary, setAiSummary] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nextFollowup, setNextFollowup] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 3)
    return d.toISOString().split('T')[0]
  })

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
        next_followup: nextFollowup,
        ...(outcome === 'published' ? { status: 'published' } : {}),
        ...(outcome === 'interested' ? { status: 'in_progress' } : {}),
        ...(outcome === 'not_interested' ? { status: 'not_relevant', temperature: 'cold' } : {}),
      }).eq('id', leadId),
    ])

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-3xl w-full max-w-lg animate-slide-up" style={{ background: '#1c1a32', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <h3 className="font-extrabold text-gray-900">תיעוד אינטראקציה</h3>
            <p className="text-sm text-gray-400 mt-0.5">עם {leadName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <X size={15} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Type */}
          <div>
            <label className="block text-xs font-extrabold text-gray-500 uppercase tracking-wider mb-2">סוג אינטראקציה</label>
            <div className="flex gap-2">
              {TYPES.map(({ value, label, icon: Icon, color }) => (
                <button key={value} onClick={() => setType(value)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${type === value ? color + ' border-current' : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'}`}>
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-extrabold text-gray-500 uppercase tracking-wider mb-2">מה קרה?</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="input-base resize-none"
              placeholder="תאר בקצרה את השיחה, מה אמר, מה ביקש..."
            />
            {notes.length > 10 && (
              <button onClick={generateSummary} disabled={aiLoading}
                className="mt-2 flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:text-purple-700 disabled:opacity-50">
                {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {aiLoading ? 'מנסח...' : 'נסח לי סיכום מקצועי עם AI'}
              </button>
            )}
          </div>

          {/* AI Summary */}
          {aiSummary && (
            <div className="rounded-2xl p-4 animate-slide-up" style={{ background: 'rgba(124,58,237,0.08)', border: '1.5px solid rgba(124,58,237,0.25)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={12} className="text-purple-500" />
                <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider">סיכום AI</p>
              </div>
              <textarea
                value={aiSummary}
                onChange={e => setAiSummary(e.target.value)}
                rows={3}
                className="w-full text-sm text-gray-700 bg-transparent resize-none outline-none"
              />
            </div>
          )}

          {/* Outcome */}
          <div>
            <label className="block text-xs font-extrabold text-gray-500 uppercase tracking-wider mb-2">תוצאה</label>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map(({ value, label }) => (
                <button key={value} onClick={() => setOutcome(value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${outcome === value ? 'sesya-gradient text-white border-transparent' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Next follow-up */}
          <div>
            <label className="block text-xs font-extrabold text-gray-500 uppercase tracking-wider mb-2">follow-up הבא</label>
            <input type="date" value={nextFollowup} onChange={e => setNextFollowup(e.target.value)} className="input-base" dir="ltr" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={handleSave} disabled={saving || !notes} className="btn-primary flex-1 disabled:opacity-40">
            {saving ? 'שומר...' : '💾 שמור אינטראקציה'}
          </button>
          <button onClick={onClose} className="btn-ghost px-5">ביטול</button>
        </div>
      </div>
    </div>
  )
}
