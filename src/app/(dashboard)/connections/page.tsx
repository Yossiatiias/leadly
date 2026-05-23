'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Connection {
  id: string
  instance_id: string
  api_token: string | null
  api_url: string | null
  bot_enabled: boolean
  status: string
  created_at: string
}

export default function ConnectionsPage() {
  const supabase = createClient()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    instance_id: '',
    api_token: '',
    api_url: 'https://7107.api.greenapi.com',
  })

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
      .from('whatsapp_connections')
      .select('*')
      .eq('business_id', profile.business_id)
      .single()

    setConnection(data || null)
    if (data) {
      setForm({
        instance_id: data.instance_id || '',
        api_token: data.api_token || '',
        api_url: data.api_url || 'https://7107.api.greenapi.com',
      })
    }
    setLoading(false)
  }

  async function saveConnection() {
    if (!form.instance_id.trim() || !form.api_token.trim() || !businessId) return
    setSaving(true)

    if (connection) {
      await supabase.from('whatsapp_connections').update({
        instance_id: form.instance_id,
        api_token: form.api_token,
        api_url: form.api_url,
      }).eq('id', connection.id)
    } else {
      await supabase.from('whatsapp_connections').insert({
        business_id: businessId,
        instance_id: form.instance_id,
        api_token: form.api_token,
        api_url: form.api_url,
        bot_enabled: true,
        status: 'connected',
      })
    }

    setSaving(false)
    setShowForm(false)
    setTestResult(null)
    await loadData()
  }

  async function toggleBot() {
    if (!connection) return
    const newVal = !connection.bot_enabled
    await supabase.from('whatsapp_connections').update({ bot_enabled: newVal }).eq('id', connection.id)
    setConnection(c => c ? { ...c, bot_enabled: newVal } : c)
  }

  async function testConnection() {
    if (!connection) return
    setTesting(true)
    setTestResult(null)

    try {
      const url = connection.api_url || 'https://7107.api.greenapi.com'
      const res = await fetch(
        `${url}/waInstance${connection.instance_id}/getStateInstance/${connection.api_token}`
      )
      const data = await res.json()
      if (data.stateInstance === 'authorized') {
        setTestResult({ ok: true, message: '✓ מחובר ומאומת בהצלחה' })
      } else {
        setTestResult({ ok: false, message: `סטטוס: ${data.stateInstance || 'לא ידוע'}` })
      }
    } catch {
      setTestResult({ ok: false, message: 'שגיאת חיבור — בדוק את ה-Instance ID וה-Token' })
    }

    setTesting(false)
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#5B8FA8' }}>טוען...</div>

  return (
    <div style={{ padding: '32px', maxWidth: '720px', margin: '0 auto', direction: 'rtl' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1A4F6E', margin: 0 }}>חיבורים</h1>
        <p style={{ fontSize: '13px', color: '#5B8FA8', marginTop: '4px' }}>
          חבר את חשבון הוואטסאפ שלך כדי שהסוכן יוכל לקבל ולשלוח הודעות
        </p>
      </div>

      {/* Webhook info box */}
      <div style={{
        background: '#EBF5FA', borderRadius: '12px', padding: '16px 20px',
        border: '1px solid #C8E3F0', marginBottom: '24px',
      }}>
        <p style={{ fontWeight: 700, color: '#1A4F6E', fontSize: '13px', margin: '0 0 6px' }}>
          🔗 כתובת Webhook להגדרה ב-Green API:
        </p>
        <code style={{ fontSize: '12px', color: '#3B6F8A', background: 'white', padding: '6px 10px', borderRadius: '6px', display: 'block' }}>
          {typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/whatsapp/webhook
        </code>
        <p style={{ fontSize: '11px', color: '#7AAEC4', margin: '8px 0 0' }}>
          ב-Green API: הגדרות Instance → Notifications → כתוב את הכתובת לעיל
        </p>
      </div>

      {/* Connection card */}
      {connection && !showForm ? (
        <div style={{
          background: 'white', borderRadius: '16px', padding: '24px',
          border: '1px solid #C8E3F0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          marginBottom: '20px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '24px',
              }}>
                📱
              </div>
              <div>
                <p style={{ fontWeight: 700, color: '#1A4F6E', fontSize: '16px', margin: 0 }}>WhatsApp (Green API)</p>
                <p style={{ fontSize: '12px', color: '#7AAEC4', margin: '3px 0 0' }}>
                  Instance: {connection.instance_id}
                </p>
              </div>
            </div>
            <span style={{
              padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: 600,
              background: '#E8F8EC', color: '#2E7D32',
            }}>
              מחובר
            </span>
          </div>

          {/* Bot toggle */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 16px', background: '#F5F9FC', borderRadius: '10px', marginBottom: '16px',
          }}>
            <div>
              <p style={{ fontWeight: 600, color: '#1A4F6E', fontSize: '14px', margin: 0 }}>סוכן AI אוטומטי</p>
              <p style={{ fontSize: '12px', color: '#7AAEC4', margin: '3px 0 0' }}>
                {connection.bot_enabled ? 'הסוכן מגיב אוטומטית להודעות נכנסות' : 'הסוכן כבוי — הודעות נשמרות בלבד'}
              </p>
            </div>
            <button
              onClick={toggleBot}
              style={{
                padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: connection.bot_enabled ? '#25D366' : '#E0E0E0',
                color: connection.bot_enabled ? 'white' : '#666',
                fontFamily: 'inherit', fontWeight: 600, fontSize: '13px',
                transition: 'all 0.2s',
              }}
            >
              {connection.bot_enabled ? '✓ פעיל' : 'כבוי'}
            </button>
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
              background: testResult.ok ? '#E8F8EC' : '#FEF2F2',
              color: testResult.ok ? '#2E7D32' : '#C0392B',
              fontSize: '13px', fontWeight: 500,
            }}>
              {testResult.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={testConnection}
              disabled={testing}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                border: '1px solid #C8E3F0', background: 'white',
                color: '#3B6F8A', fontFamily: 'inherit', fontWeight: 600,
                fontSize: '13px', cursor: testing ? 'default' : 'pointer',
              }}
            >
              {testing ? 'בודק...' : '🔍 בדוק חיבור'}
            </button>
            <button
              onClick={() => setShowForm(true)}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                border: '1px solid #C8E3F0', background: 'white',
                color: '#3B6F8A', fontFamily: 'inherit', fontWeight: 600,
                fontSize: '13px', cursor: 'pointer',
              }}
            >
              ✏️ ערוך הגדרות
            </button>
          </div>
        </div>
      ) : null}

      {/* Empty state */}
      {!connection && !showForm && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'white', borderRadius: '16px', border: '1px solid #E0EEF5',
          marginBottom: '20px',
        }}>
          <p style={{ fontSize: '48px', margin: '0 0 12px' }}>📱</p>
          <p style={{ color: '#3B6F8A', fontSize: '16px', fontWeight: 600 }}>אין חיבור וואטסאפ</p>
          <p style={{ color: '#7AAEC4', fontSize: '13px', marginBottom: '24px' }}>חבר את חשבון הוואטסאפ שלך כדי להתחיל</p>
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '12px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer',
              background: '#25D366', color: 'white', fontWeight: 600, fontSize: '14px',
              fontFamily: 'inherit',
            }}
          >
            + חבר וואטסאפ
          </button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{
          background: 'white', borderRadius: '16px', padding: '24px',
          border: '1px solid #C8E3F0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          marginBottom: '20px',
        }}>
          <h3 style={{ margin: '0 0 20px', color: '#1A4F6E', fontSize: '16px' }}>
            {connection ? 'ערוך חיבור' : 'הוסף חיבור Green API'}
          </h3>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              Instance ID
            </label>
            <input
              value={form.instance_id}
              onChange={e => setForm(f => ({ ...f, instance_id: e.target.value }))}
              placeholder="למשל: 7107622341"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              API Token
            </label>
            <input
              value={form.api_token}
              onChange={e => setForm(f => ({ ...f, api_token: e.target.value }))}
              placeholder="הטוקן מ-Green API"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3B6F8A', marginBottom: '6px' }}>
              API URL
            </label>
            <input
              value={form.api_url}
              onChange={e => setForm(f => ({ ...f, api_url: e.target.value }))}
              placeholder="https://7107.api.greenapi.com"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1px solid #C8E3F0', fontSize: '14px', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: '#7AAEC4', margin: '5px 0 0' }}>
              מצא את ה-URL ב-Green API ← הגדרות Instance
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: '1px solid #C8E3F0',
                background: 'white', color: '#5B8FA8', fontFamily: 'inherit', cursor: 'pointer', fontSize: '13px',
              }}
            >
              ביטול
            </button>
            <button
              onClick={saveConnection}
              disabled={saving || !form.instance_id.trim() || !form.api_token.trim()}
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

      {/* Instructions */}
      <div style={{
        background: 'white', borderRadius: '12px', padding: '20px',
        border: '1px solid #E0EEF5',
      }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A4F6E', margin: '0 0 14px' }}>
          איך מחברים Green API?
        </h3>
        {[
          ['1', 'היכנס ל-green-api.com והתחבר לחשבונך'],
          ['2', 'בחר את ה-Instance שיצרת וחבר אליו וואטסאפ'],
          ['3', 'העתק את Instance ID ואת API Token'],
          ['4', 'הזן אותם בטופס למעלה ולחץ שמור'],
          ['5', 'הגדר את כתובת ה-Webhook ב-Green API (ראה למעלה)'],
        ].map(([num, text]) => (
          <div key={num} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'flex-start' }}>
            <span style={{
              width: '22px', height: '22px', borderRadius: '50%',
              background: '#3FA9DC', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 700, flexShrink: 0,
            }}>{num}</span>
            <p style={{ fontSize: '13px', color: '#3B6F8A', margin: 0, lineHeight: 1.5 }}>{text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
