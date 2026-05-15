'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { MessageCircle, CheckCircle } from 'lucide-react'

export default function QuickAddPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', notes: '' })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const followup = new Date()
    followup.setDate(followup.getDate() + 3)

    await supabase.from('leads').insert({
      name: form.name,
      phone: form.phone || null,
      notes: form.notes || null,
      source: 'whatsapp',
      status: 'new',
      next_followup: followup.toISOString(),
    })

    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mb-4">
            <CheckCircle size={32} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">הליד נוסף בהצלחה!</h2>
          <p className="text-slate-500 text-sm mb-6">תזכורת follow-up נקבעה לעוד 3 ימים</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setDone(false); setForm({ name: '', phone: '', notes: '' }) }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              הוסף עוד ליד
            </button>
            <button
              onClick={() => router.push('/leads')}
              className="bg-white hover:bg-slate-50 text-slate-700 font-medium px-5 py-2.5 rounded-lg text-sm border border-slate-300 transition-colors"
            >
              לרשימת הלידים
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-xl mb-3">
            <MessageCircle size={24} className="text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">הוסף ליד מוואטסאפ</h1>
          <p className="text-slate-500 text-sm mt-1">מלא את הפרטים הבסיסיים</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">שם *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="שם מלא"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">טלפון</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="050-0000000"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">הערה קצרה</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="w-full px-3 py-3 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              placeholder="מה דיברתם?"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg text-base transition-colors"
          >
            {loading ? 'שומר...' : 'הוסף לידים'}
          </button>
        </form>
      </div>
    </div>
  )
}
