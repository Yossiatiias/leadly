'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Check, Edit2, Wifi, WifiOff, Copy } from 'lucide-react'

interface Connection {
  id: string
  instance_id: string
  api_token: string | null
  api_url: string | null
  bot_enabled: boolean
  status: string
}

export default function ConnectionsPage() {
  const supabase = createClient()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    instance_id: '',
    api_token: '',
    api_url: 'https://7107.api.greenapi.com',
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return
    setBusinessId(profile.business_id)
    const { data } = await supabase.from('whatsapp_connections').select('*').eq('business_id', profile.business_id).single()
    setConnection(data || null)
    if (data) setForm({ instance_id: data.instance_id || '', api_token: data.api_token || '', api_url: data.api_url || 'https://7107.api.greenapi.com' })
    setLoading(false)
  }

  async function saveConnection() {
    if (!form.instance_id.trim() || !form.api_token.trim() || !businessId) return
    setSaving(true)
    if (connection) {
      await supabase.from('whatsapp_connections').update({ instance_id: form.instance_id, api_token: form.api_token, api_url: form.api_url }).eq('id', connection.id)
    } else {
      await supabase.from('whatsapp_connections').insert({ business_id: businessId, instance_id: form.instance_id, api_token: form.api_token, api_url: form.api_url, bot_enabled: true, status: 'connected' })
    }
    setSaving(false)
    setExpanded(null)
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
    setTesting(true); setTestResult(null)
    try {
      const url = connection.api_url || 'https://7107.api.greenapi.com'
      const res = await fetch(`${url}/waInstance${connection.instance_id}/getStateInstance/${connection.api_token}`)
      const data = await res.json()
      setTestResult(data.stateInstance === 'authorized'
        ? { ok: true, message: '✓ מחובר ומאומת בהצלחה' }
        : { ok: false, message: `סטטוס: ${data.stateInstance || 'לא ידוע'}` })
    } catch {
      setTestResult({ ok: false, message: 'שגיאת חיבור — בדוק Instance ID וToken' })
    }
    setTesting(false)
  }

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : 'https://your-domain.com/api/whatsapp/webhook'

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)' }}>טוען...</div>

  const cards = [
    {
      id: 'whatsapp',
      icon: '📱',
      bg: '#25D366',
      title: 'WhatsApp (Green API)',
      subtitle: connection ? `Instance: ${connection.instance_id}` : 'לא מחובר',
      status: connection ? 'connected' : 'disconnected',
      statusLabel: connection ? 'מחובר' : 'לא מחובר',
      available: true,
    },
    {
      id: 'webhook',
      icon: '🔗',
      bg: 'var(--brand)',
      title: 'Webhook URL',
      subtitle: 'כתובת שמזינים ב-Green API',
      status: 'info',
      statusLabel: 'פעיל',
      available: true,
    },
    {
      id: 'facebook',
      icon: 'f',
      bg: '#1877F2',
      title: 'Facebook Leads',
      subtitle: 'ייבוא לידים ממודעות',
      status: 'soon',
      statusLabel: 'בקרוב',
      available: false,
    },
    {
      id: 'gcal',
      icon: '📅',
      bg: '#4285F4',
      title: 'Google Calendar',
      subtitle: 'סנכרון תורים דו-כיווני',
      status: 'soon',
      statusLabel: 'בקרוב',
      available: false,
    },
  ]

  const statusColors: Record<string, { bg: string; color: string }> = {
    connected:    { bg: '#DCFCE7', color: '#15803D' },
    disconnected: { bg: '#FEE2E2', color: '#DC2626' },
    info:         { bg: 'var(--brand-soft)', color: 'var(--brand)' },
    soon:         { bg: 'var(--bg-sunken)', color: 'var(--fg-4)' },
  }

  return (
    <div style={{ padding: '32px', maxWidth: '860px', margin: '0 auto', direction: 'rtl' }}>

      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--fg-1)', margin: 0 }}>חיבורים</h1>
        <p style={{ fontSize: '13px', color: 'var(--fg-3)', marginTop: '4px' }}>
          נהל את האינטגרציות של המערכת עם שירותים חיצוניים
        </p>
      </div>

      {/* 2×2 card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        {cards.map(card => {
          const sc = statusColors[card.status]
          const isOpen = expanded === card.id
          return (
            <div key={card.id}
              onClick={() => card.available ? setExpanded(isOpen ? null : card.id) : undefined}
              style={{
                background: 'var(--bg-surface)', borderRadius: '16px', padding: '22px',
                border: `1px solid ${isOpen ? 'var(--brand)' : 'var(--border-default)'}`,
                cursor: card.available ? 'pointer' : 'default',
                opacity: card.available ? 1 : 0.65,
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: isOpen ? '0 0 0 3px var(--brand-soft)' : 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '52px', height: '52px', borderRadius: '14px', background: card.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '22px', fontWeight: 900, color: 'white', flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '15px', margin: 0 }}>{card.title}</p>
                  <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.subtitle}</p>
                </div>
                <span style={{ padding: '4px 11px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: sc.bg, color: sc.color, flexShrink: 0 }}>
                  {card.statusLabel}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* WhatsApp detail panel */}
      {expanded === 'whatsapp' && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '24px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '15px', margin: '0 0 18px' }}>
            הגדרות WhatsApp (Green API)
          </h3>

          {/* Bot toggle (only if connected) */}
          {connection && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-sunken)', borderRadius: '10px', marginBottom: '16px' }}>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '14px', margin: 0 }}>סוכן AI אוטומטי</p>
                <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '2px 0 0' }}>
                  {connection.bot_enabled ? 'מגיב אוטומטית להודעות נכנסות' : 'כבוי — הודעות נשמרות בלבד'}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); toggleBot() }} style={{
                padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: connection.bot_enabled ? '#25D366' : 'var(--bg-hover)',
                color: connection.bot_enabled ? 'white' : 'var(--fg-2)',
                fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', transition: 'all 0.2s',
              }}>
                {connection.bot_enabled ? '✓ פעיל' : 'כבוי'}
              </button>
            </div>
          )}

          {/* Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            {[
              { label: 'Instance ID', key: 'instance_id', placeholder: '7107622341', dir: 'ltr' as const },
              { label: 'API Token',   key: 'api_token',   placeholder: 'הטוקן מ-Green API', dir: 'ltr' as const },
              { label: 'API URL',     key: 'api_url',     placeholder: 'https://7107.api.greenapi.com', dir: 'ltr' as const },
            ].map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '5px' }}>{f.label}</label>
                <input
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  dir={f.dir}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-sunken)', color: 'var(--fg-1)', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            ))}
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', background: testResult.ok ? '#DCFCE7' : '#FEE2E2', color: testResult.ok ? '#15803D' : '#DC2626', fontSize: '13px', fontWeight: 500 }}>
              {testResult.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }} onClick={e => e.stopPropagation()}>
            {connection && (
              <button onClick={testConnection} disabled={testing} style={{
                padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--border-default)',
                background: 'var(--bg-surface)', color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '13px', cursor: testing ? 'default' : 'pointer',
              }}>
                {testing ? 'בודק...' : '🔍 בדוק חיבור'}
              </button>
            )}
            <button onClick={saveConnection} disabled={saving || !form.instance_id.trim() || !form.api_token.trim()} style={{
              padding: '9px 20px', borderRadius: '8px', border: 'none',
              background: saving ? 'var(--brand-soft)' : 'var(--brand)',
              color: saving ? 'var(--brand)' : 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: saving ? 'default' : 'pointer',
            }}>
              {saving ? 'שומר...' : connection ? '✏️ עדכן' : '+ חבר'}
            </button>
          </div>
        </div>
      )}

      {/* Webhook detail panel */}
      {expanded === 'webhook' && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '24px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '15px', margin: '0 0 8px' }}>
            🔗 Webhook URL
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-3)', marginBottom: '6px' }}>
            <strong>מה זה Webhook?</strong> כשמישהו שולח הודעת WhatsApp, Green API מעביר אותה לכתובת זו — כך הסוכן שלנו מקבל את ההודעה ומגיב.
          </p>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginBottom: '12px' }}>
            <strong>איך מגדירים:</strong> היכנס ל-Green API ← בחר Instance ← Notifications ← הדבק כתובת זו בשדה "Webhook URL"
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <code style={{ flex: 1, fontSize: '12px', color: 'var(--fg-2)', background: 'var(--bg-sunken)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', direction: 'ltr', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {webhookUrl}
            </code>
            <button onClick={copyWebhook} style={{
              padding: '9px 14px', borderRadius: '8px', border: '1px solid var(--border-default)',
              background: copied ? 'var(--success-soft)' : 'var(--bg-surface)',
              color: copied ? 'var(--success)' : 'var(--fg-2)',
              fontFamily: 'inherit', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}>
              {copied ? <><Check size={13} /> הועתק</> : <><Copy size={13} /> העתק</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
