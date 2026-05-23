'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface QAItem {
  id: string
  question: string
  answer: string
  category: string
  is_active: boolean
}

const CATEGORIES = ['כללי', 'שעות פעילות', 'מחירים', 'שירותים', 'מיקום והגעה', 'אחר']

export default function QAPage() {
  const supabase = createClient()
  const [items, setItems] = useState<QAItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ question: '', answer: '', category: 'כללי' })
  const [businessId, setBusinessId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.business_id) return
    setBusinessId(profile.business_id)

    const { data } = await supabase
      .from('qa_knowledge')
      .select('*')
      .eq('business_id', profile.business_id)
      .order('category')

    setItems(data || [])
    setLoading(false)
  }

  async function saveItem() {
    if (!form.question.trim() || !form.answer.trim() || !businessId) return
    setSaving(true)

    if (editingId) {
      await supabase.from('qa_knowledge').update({
        question: form.question,
        answer: form.answer,
        category: form.category,
      }).eq('id', editingId)
    } else {
      await supabase.from('qa_knowledge').insert({
        business_id: businessId,
        question: form.question,
        answer: form.answer,
        category: form.category,
        is_active: true,
      })
    }

    setForm({ question: '', answer: '', category: 'כללי' })
    setEditingId(null)
    setShowForm(false)
    setSaving(false)
    loadData()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('qa_knowledge').update({ is_active: !current }).eq('id', id)
    loadData()
  }

  async function deleteItem(id: string) {
    if (!confirm('למחוק את השאלה הזו?')) return
    await supabase.from('qa_knowledge').delete().eq('id', id)
    loadData()
  }

  function startEdit(item: QAItem) {
    setForm({ question: item.question, answer: item.answer, category: item.category })
    setEditingId(item.id)
    setShowForm(true)
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#5B8FA8' }}>טוען...</div>

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = items.filter(i => i.category === cat)
    return acc
  }, {} as Record<string, QAItem[]>)

  return (
    <div style={{ padding: '32px', maxWidth: '860px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1A4F6E', margin: 0 }}>שאלות ותשובות</h1>
          <p style={{ fontSize: '13px', color: '#5B8FA8', marginTop: '4px' }}>
            מאגר הידע שממנו הסוכן לוקח מידע כשמתכתב עם לקוחות
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ question: '', answer: '', category: 'כללי' }) }}
          style={{
            padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
            background: '#3FA9DC', color: 'white', fontWeight: 600, fontSize: '14px',
            fontFamily: 'inherit',
          }}
        >
          + שאלה חדשה
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{
          background: 'white', borderRadius: '14px', padding: '24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginBottom: '28px',
          border: '1px solid #E0EEF5',
        }}>
          <h3 style={{ margin: '0 0 16px', color: '#1A4F6E', fontSize: '16px' }}>
            {editingId ? 'עריכת שאלה' : 'שאלה חדשה'}
          </h3>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              קטגוריה
            </label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                background: 'white', color: '#1A4F6E',
              }}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              שאלה
            </label>
            <input
              value={form.question}
              onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              placeholder="למשל: מה שעות הפעילות שלכם?"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              תשובה
            </label>
            <textarea
              value={form.answer}
              onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
              placeholder="למשל: אנחנו פתוחים ימים א׳-ה׳ בין 9:00-18:00, שישי 9:00-13:00"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowForm(false); setEditingId(null) }}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: '1px solid #C8E3F0',
                background: 'white', color: '#5B8FA8', fontFamily: 'inherit', cursor: 'pointer', fontSize: '13px',
              }}
            >
              ביטול
            </button>
            <button
              onClick={saveItem}
              disabled={saving || !form.question.trim() || !form.answer.trim()}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: 'none',
                background: saving ? '#A8D5EE' : '#3FA9DC', color: 'white',
                fontFamily: 'inherit', cursor: saving ? 'default' : 'pointer',
                fontWeight: 600, fontSize: '13px',
              }}
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      )}

      {/* Items by category */}
      {items.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'white', borderRadius: '14px', border: '1px solid #E0EEF5',
        }}>
          <p style={{ fontSize: '32px', margin: '0 0 12px' }}>💡</p>
          <p style={{ color: '#3B6F8A', fontSize: '16px', fontWeight: 600 }}>עדיין אין שאלות</p>
          <p style={{ color: '#7AAEC4', fontSize: '13px' }}>הוסף שאלות ותשובות כדי שהסוכן יוכל לענות ללקוחות</p>
        </div>
      ) : (
        CATEGORIES.map(cat => {
          const catItems = grouped[cat]
          if (catItems.length === 0) return null
          return (
            <div key={cat} style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#5B8FA8', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {cat} ({catItems.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {catItems.map(item => (
                  <div key={item.id} style={{
                    background: 'white', borderRadius: '12px', padding: '16px 18px',
                    border: `1px solid ${item.is_active ? '#C8E3F0' : '#E8E8E8'}`,
                    opacity: item.is_active ? 1 : 0.6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600, color: '#1A4F6E', fontSize: '14px', margin: '0 0 6px' }}>
                          {item.question}
                        </p>
                        <p style={{ color: '#5B8FA8', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                          {item.answer}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => toggleActive(item.id, item.is_active)}
                          title={item.is_active ? 'השבת' : 'הפעל'}
                          style={{
                            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
                            background: item.is_active ? '#E8F8EC' : '#F0F0F0',
                            cursor: 'pointer', fontSize: '14px',
                          }}
                        >
                          {item.is_active ? '✓' : '○'}
                        </button>
                        <button
                          onClick={() => startEdit(item)}
                          style={{
                            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
                            background: '#EBF5FA', cursor: 'pointer', fontSize: '13px',
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          style={{
                            width: '28px', height: '28px', borderRadius: '6px', border: 'none',
                            background: '#FEF2F2', cursor: 'pointer', fontSize: '13px',
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
