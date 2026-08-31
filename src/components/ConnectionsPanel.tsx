'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Check, Copy } from 'lucide-react'
import { greenApiUrl } from '@/lib/greenApi'
import { useConfirm } from '@/hooks/useConfirm'

// אייקונים רשמיים (WhatsApp/Facebook) — קבצי הלוגו המקוריים מ-Meta Brand
// Resource Center (public/brand/), לא ציור מקורב. אסור לפי הכללים שלהם
// לשנות צבע/צורה — אלה בדיוק הגרסאות ה"לבן על רקע שקוף" הרשמיות שלהם,
// מוצגות כאן על הרקע הצבעוני הרשמי שלהם (ירוק/כחול) בלי שום שינוי לקובץ עצמו
// eslint-disable-next-line @next/next/no-img-element
function WhatsAppIcon() {
  return <img src="/brand/whatsapp-glyph-white.svg" alt="WhatsApp" width={26} height={26} />
}

// eslint-disable-next-line @next/next/no-img-element
function FbIcon() {
  return <img src="/brand/facebook-logo-secondary.png" alt="Facebook" width={24} height={24} />
}

// eslint-disable-next-line @next/next/no-img-element
function GoogleCalIcon() {
  return <img src="/brand/google-calendar.png" alt="Google Calendar" width={28} height={28} />
}

function OptimaIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="5" width="18" height="17" rx="2.5" stroke="white" strokeWidth="2"/>
      <path d="M4 10h18" stroke="white" strokeWidth="2"/>
      <path d="M8.5 3v4M17.5 3v4" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

function WebhookIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

interface Connection {
  id: string
  instance_id: string
  api_token: string | null
  api_url: string | null
  bot_enabled: boolean
  status: string
}

// תרגום מצב אמיתי מ-Green API (getStateInstance) לתווית בעברית — אותם מצבים
// כמו בפאנל הבריאות של האדמין (connections-health/route.ts), רק בשביל
// שהמשתמש עצמו יראה בכניסה להגדרות אם הוואטסאפ באמת מחובר, לא רק אם יש
// רשומת חיבור ב-DB (שיכולה להישאר "מחובר" גם אחרי שהטלפון התנתק בפועל).
// tone 'warning' (לא 'disconnected') ל-suspended/yellowCard: קרה בפועל
// ש-Green API דיווח "suspended" בזמן שהודעות עדיין נקלטו ונענו תקין — זה
// לא בהכרח באמת חסימה, אז לא מציגים את זה כאדום/"מנותק" מטעה. תוויות
// קצרות בכוונה (לא ברוחב מלא) כדי שלא יידחקו את שאר הכרטיס — הפירוט נשאר
// רק בפאנל המורחב, לא בבאדג' הקומפקטי
const LIVE_STATE_META: Record<string, { label: string; tone: 'connected' | 'disconnected' | 'warning' }> = {
  authorized:    { label: 'מחובר',        tone: 'connected' },
  yellowCard:    { label: 'כרטיס צהוב',    tone: 'warning' },
  blocked:       { label: 'חסום',          tone: 'disconnected' },
  notAuthorized: { label: 'צריך QR מחדש', tone: 'disconnected' },
  sleepMode:     { label: 'טלפון מנותק',   tone: 'disconnected' },
  suspended:     { label: 'מושהה',         tone: 'warning' },
  starting:      { label: 'מתאתחל',        tone: 'warning' },
}

interface GCalInfo { email: string; connected_at: string }

export default function ConnectionsPanel() {
  const supabase = createClient()
  const { confirm, ConfirmDialog } = useConfirm()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [liveState, setLiveState] = useState<{ label: string; tone: 'connected' | 'disconnected' | 'warning' } | null>(null)
  const [gcalInfo, setGcalInfo] = useState<GCalInfo | null>(null)
  const [gcalMsg, setGcalMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [form, setForm] = useState({
    instance_id: '',
    api_token: '',
    api_url: 'https://7107.api.greenapi.com',
  })
  const [optimaConfig, setOptimaConfig] = useState<{ base_url: string; username: string; password: string; company: string } | null>(null)
  const [optimaForm, setOptimaForm] = useState({ base_url: 'https://calendar.hatosafim.co.il/api2', username: '', password: '', company: '' })
  const [optimaSaving, setOptimaSaving] = useState(false)
  const [optimaTesting, setOptimaTesting] = useState(false)
  const [optimaTestResult, setOptimaTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    loadData()
    const p = new URLSearchParams(window.location.search)
    if (p.get('gcal') === 'ok')    setGcalMsg({ ok: true,  text: '✓ גוגל קלנדר חובר בהצלחה!' })
    if (p.get('gcal') === 'error') setGcalMsg({ ok: false, text: 'שגיאה בחיבור — נסה שוב' })
    if (p.get('gcal')) window.history.replaceState({}, '', '/settings')
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) { setLoading(false); return }
    setBusinessId(profile.business_id)

    const [waRes, bizRes] = await Promise.all([
      supabase.from('whatsapp_connections').select('*').eq('business_id', profile.business_id).single(),
      supabase.from('businesses').select('settings').eq('id', profile.business_id).single(),
    ])
    setConnection(waRes.data || null)
    if (waRes.data) setForm({ instance_id: waRes.data.instance_id || '', api_token: waRes.data.api_token || '', api_url: waRes.data.api_url || 'https://7107.api.greenapi.com' })

    const gcal = (bizRes.data?.settings as Record<string, unknown>)?.google_calendar as GCalInfo | undefined
    setGcalInfo(gcal || null)

    const optima = (bizRes.data?.settings as Record<string, unknown>)?.optima as typeof optimaConfig
    setOptimaConfig(optima || null)
    if (optima) setOptimaForm(optima)

    setLoading(false)

    // בדיקת מצב אמיתית מול Green API — לא סומכים על connection.status ב-DB
    // בלבד, כי הוא נשאר "מחובר" גם אחרי שהחיבור בפועל התנתק/הושעה (קרה
    // בפועל: לקוח שלח הודעה שלא הגיעה בכלל למערכת, וב-DB עדיין הופיע "מחובר")
    if (waRes.data?.instance_id && waRes.data?.api_token) {
      try {
        const url = waRes.data.api_url || 'https://7107.api.greenapi.com'
        const res = await fetch(greenApiUrl(url, waRes.data.instance_id, 'getStateInstance', waRes.data.api_token))
        const data = await res.json()
        const meta = LIVE_STATE_META[data?.stateInstance] || null
        setLiveState(meta || { label: data?.stateInstance || 'לא ידוע', tone: 'disconnected' })
      } catch {
        setLiveState({ label: 'שגיאה בבדיקת חיבור', tone: 'disconnected' })
      }
    }
  }

  async function disconnectGcal() {
    if (!businessId || !(await confirm('לנתק את גוגל קלנדר?'))) return
    setDisconnecting(true)
    await fetch('/api/calendar/sync', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId }),
    })
    setGcalInfo(null)
    setDisconnecting(false)
    setExpanded(null)
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
      const res = await fetch(greenApiUrl(url, connection.instance_id, 'getStateInstance', connection.api_token))
      const data = await res.json()
      setTestResult(data.stateInstance === 'authorized'
        ? { ok: true, message: '✓ מחובר ומאומת בהצלחה' }
        : { ok: false, message: `סטטוס: ${data.stateInstance || 'לא ידוע'}` })
    } catch {
      setTestResult({ ok: false, message: 'שגיאת חיבור — בדוק Instance ID וToken' })
    }
    setTesting(false)
  }

  async function saveOptima() {
    if (!optimaForm.base_url.trim() || !optimaForm.username.trim() || !optimaForm.password.trim() || !optimaForm.company.trim() || !businessId) return
    setOptimaSaving(true)
    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
    const currentSettings = biz?.settings || {}
    await supabase.from('businesses').update({
      settings: { ...currentSettings, optima: optimaForm },
    }).eq('id', businessId)
    setOptimaSaving(false)
    setExpanded(null)
    setOptimaTestResult(null)
    await loadData()
  }

  // בדיקת חיבור לאופטימה חייבת לעבור דרך השרת שלנו, לא ישירות מהדפדפן —
  // ל-API של אופטימה אין תמיכה ב-CORS (הם בנויים לתקשורת שרת-לשרת), אז
  // קריאה ישירה מהדפדפן נכשלת עם שגיאת רשת גנרית גם כשהפרטים תקינים לגמרי
  async function testOptima() {
    if (!optimaForm.base_url.trim() || !optimaForm.username.trim() || !optimaForm.password.trim() || !optimaForm.company.trim()) return
    setOptimaTesting(true); setOptimaTestResult(null)
    try {
      const res = await fetch('/api/settings/test-optima', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optimaForm),
      })
      const data = await res.json()
      setOptimaTestResult(data)
    } catch {
      setOptimaTestResult({ ok: false, message: 'שגיאת חיבור — נסה שוב' })
    }
    setOptimaTesting(false)
  }

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : 'https://your-domain.com/api/whatsapp/webhook'

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--fg-3)' }}>טוען...</div>

  const cards: { id: string; icon: React.ReactNode; bg: string; title: string; subtitle: string; status: string; statusLabel: string; available: boolean }[] = [
    {
      id: 'whatsapp',
      icon: <WhatsAppIcon />,
      bg: '#25D366',
      title: 'WhatsApp (Green API)',
      subtitle: connection ? `Instance: ${connection.instance_id}` : 'לא מחובר',
      status: !connection ? 'disconnected' : (liveState ? liveState.tone : 'connected'),
      statusLabel: !connection ? 'לא מחובר' : (liveState ? liveState.label : 'בודק חיבור...'),
      available: true,
    },
    {
      id: 'webhook',
      icon: <WebhookIcon />,
      bg: 'var(--brand)',
      title: 'Webhook URL',
      subtitle: 'כתובת שמזינים ב-Green API',
      status: 'info',
      statusLabel: 'פעיל',
      available: true,
    },
    {
      id: 'facebook',
      icon: <FbIcon />,
      bg: '#1877F2',
      title: 'Facebook Leads',
      subtitle: 'ייבוא לידים ממודעות',
      status: 'soon',
      statusLabel: 'בקרוב',
      available: false,
    },
    {
      id: 'gcal',
      icon: <GoogleCalIcon />,
      bg: 'white',
      title: 'Google Calendar',
      subtitle: gcalInfo ? gcalInfo.email : 'סנכרון תורים דו-כיווני',
      status: gcalInfo ? 'connected' : 'disconnected',
      statusLabel: gcalInfo ? 'מחובר' : 'לא מחובר',
      available: true,
    },
    {
      id: 'optima',
      icon: <OptimaIcon />,
      bg: '#0F766E',
      title: 'אופטימה',
      subtitle: optimaConfig ? `Company: ${optimaConfig.company}` : 'שליחת תורים ליומן המרפאה',
      status: optimaConfig ? 'connected' : 'disconnected',
      statusLabel: optimaConfig ? 'מחובר' : 'לא מחובר',
      available: true,
    },
  ]

  const statusColors: Record<string, { bg: string; color: string }> = {
    connected:    { bg: '#DCFCE7', color: '#15803D' },
    disconnected: { bg: '#FEE2E2', color: '#DC2626' },
    warning:      { bg: '#FEF3C7', color: '#B45309' },
    info:         { bg: 'var(--brand-soft)', color: 'var(--brand)' },
    soon:         { bg: 'var(--bg-sunken)', color: 'var(--fg-4)' },
  }

  return (
    <div style={{ direction: 'rtl' }}>
      <p style={{ fontSize: '13px', color: 'var(--fg-3)', margin: '0 0 16px' }}>
        נהל את האינטגרציות של המערכת עם שירותים חיצוניים
      </p>

      {/* 2×2 card grid */}
      <div className="grid-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        {cards.map(card => {
          const sc = statusColors[card.status]
          const isOpen = expanded === card.id
          return (
            <div key={card.id}
              onClick={() => card.available ? setExpanded(isOpen ? null : card.id) : undefined}
              style={{
                background: 'var(--bg-sunken)', borderRadius: '14px', padding: '18px',
                border: `1px solid ${isOpen ? 'var(--brand)' : 'var(--border-default)'}`,
                cursor: card.available ? 'pointer' : 'default',
                opacity: card.available ? 1 : 0.65,
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: isOpen ? '0 0 0 3px var(--brand-soft)' : 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px', background: card.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px', fontWeight: 900, color: 'white', flexShrink: 0,
                }}>
                  {card.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px', margin: 0 }}>{card.title}</p>
                  <p style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '3px 0 6px', wordBreak: 'break-word' }}>{card.subtitle}</p>
                  <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: '99px', fontSize: '10px', fontWeight: 600, background: sc.bg, color: sc.color }}>
                    {card.statusLabel}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* WhatsApp detail panel */}
      {expanded === 'whatsapp' && (
        <div style={{ background: 'var(--bg-sunken)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px', margin: '0 0 16px' }}>
            הגדרות WhatsApp (Green API)
          </h3>

          {/* Bot toggle (only if connected) */}
          {connection && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: '10px', marginBottom: '16px' }}>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: '13px', margin: 0 }}>סוכן AI אוטומטי</p>
                <p style={{ fontSize: '11px', color: 'var(--fg-3)', margin: '2px 0 0' }}>
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
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', boxSizing: 'border-box', outline: 'none' }}
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

          <div className="flex-wrap-mobile" style={{ display: 'flex', gap: '10px' }} onClick={e => e.stopPropagation()}>
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
        <div style={{ background: 'var(--bg-sunken)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px', margin: '0 0 8px' }}>
            🔗 Webhook URL
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-3)', marginBottom: '6px' }}>
            <strong>מה זה Webhook?</strong> כשמישהו שולח הודעת WhatsApp, Green API מעביר אותה לכתובת זו — כך הסוכן שלנו מקבל את ההודעה ומגיב.
          </p>
          <p style={{ fontSize: '12px', color: 'var(--fg-4)', marginBottom: '12px' }}>
            <strong>איך מגדירים:</strong> היכנס ל-Green API ← בחר Instance ← Notifications ← הדבק כתובת זו בשדה "Webhook URL"
          </p>
          <div className="flex-wrap-mobile" style={{ display: 'flex', gap: '10px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <code style={{ flex: 1, fontSize: '12px', color: 'var(--fg-2)', background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', direction: 'ltr', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* Google Calendar detail panel */}
      {expanded === 'gcal' && (
        <div style={{ background: 'var(--bg-sunken)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'white', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GoogleCalIcon />
            </div>
            <div>
              <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px', margin: 0 }}>Google Calendar</h3>
              {gcalInfo && <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '2px 0 0' }}>{gcalInfo.email}</p>}
            </div>
          </div>

          {gcalMsg && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', background: gcalMsg.ok ? '#DCFCE7' : '#FEE2E2', color: gcalMsg.ok ? '#15803D' : '#DC2626', fontSize: '13px', fontWeight: 500 }}>
              {gcalMsg.text}
            </div>
          )}

          {gcalInfo ? (
            <div>
              <div style={{ padding: '12px 16px', background: '#DCFCE7', borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>✅</span>
                <div>
                  <p style={{ fontWeight: 600, color: '#15803D', fontSize: '13px', margin: 0 }}>מחובר ל-{gcalInfo.email}</p>
                  <p style={{ fontSize: '11px', color: '#16A34A', margin: '2px 0 0' }}>תורים מגוגל קלנדר יסונכרנו אוטומטית</p>
                </div>
              </div>
              <button onClick={disconnectGcal} disabled={disconnecting} style={{
                padding: '9px 16px', borderRadius: '8px', border: '1px solid #FECACA',
                background: 'var(--bg-surface)', color: '#EF4444',
                fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer',
              }}>
                {disconnecting ? 'מנתק...' : '🔌 נתק גוגל קלנדר'}
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--fg-3)', lineHeight: 1.6, marginBottom: '16px' }}>
                חבר את גוגל קלנדר שלך כדי לסנכרן תורים אוטומטית — תורים שנוספו בגוגל יופיעו ב-BetterLead ולהיפך.
              </p>
              <a href="/api/auth/google" style={{
                display: 'inline-flex', alignItems: 'center', gap: '10px',
                padding: '10px 20px', borderRadius: '10px', border: '1px solid #E2E8F0',
                background: 'white', color: '#1a1a1a', textDecoration: 'none',
                fontFamily: 'inherit', fontWeight: 600, fontSize: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
                </svg>
                התחבר עם Google
              </a>
            </div>
          )}
        </div>
      )}

      {/* Optima detail panel */}
      {expanded === 'optima' && (
        <div style={{ background: 'var(--bg-sunken)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-default)', marginBottom: '16px' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--fg-1)', fontSize: '14px', margin: '0 0 6px' }}>
            הגדרות אופטימה
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--fg-3)', margin: '0 0 16px', lineHeight: 1.6 }}>
            כשהבוט קובע תור, הוא יישלח אוטומטית גם ליומן של אופטימה. את הפרטים מקבלים מנציג הפיתוח של אופטימה.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            {[
              { label: 'כתובת בסיס (Base URL)', key: 'base_url', placeholder: 'https://calendar.hatosafim.co.il/api2', dir: 'ltr' as const },
              { label: 'שם משתמש',              key: 'username', placeholder: 'שם המשתמש שקיבלתם', dir: 'ltr' as const },
              { label: 'סיסמה',                 key: 'password', placeholder: 'הסיסמה שקיבלתם', dir: 'ltr' as const, type: 'password' as const },
              { label: 'מספר חברה (Company)',   key: 'company',  placeholder: '1', dir: 'ltr' as const },
            ].map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)', marginBottom: '5px' }}>{f.label}</label>
                <input
                  type={'type' in f ? f.type : 'text'}
                  value={optimaForm[f.key as keyof typeof optimaForm]}
                  onChange={e => setOptimaForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  dir={f.dir}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-surface)', color: 'var(--fg-1)', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            ))}
          </div>

          {optimaTestResult && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', background: optimaTestResult.ok ? '#DCFCE7' : '#FEE2E2', color: optimaTestResult.ok ? '#15803D' : '#DC2626', fontSize: '13px', fontWeight: 500 }}>
              {optimaTestResult.message}
            </div>
          )}

          <div className="flex-wrap-mobile" style={{ display: 'flex', gap: '10px' }} onClick={e => e.stopPropagation()}>
            <button onClick={testOptima} disabled={optimaTesting} style={{
              padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: '13px', cursor: optimaTesting ? 'default' : 'pointer',
            }}>
              {optimaTesting ? 'בודק...' : '🔍 בדוק חיבור'}
            </button>
            <button onClick={saveOptima} disabled={optimaSaving || !optimaForm.base_url.trim() || !optimaForm.username.trim() || !optimaForm.password.trim() || !optimaForm.company.trim()} style={{
              padding: '9px 20px', borderRadius: '8px', border: 'none',
              background: optimaSaving ? 'var(--brand-soft)' : 'var(--brand)',
              color: optimaSaving ? 'var(--brand)' : 'white',
              fontFamily: 'inherit', fontWeight: 600, fontSize: '13px', cursor: optimaSaving ? 'default' : 'pointer',
            }}>
              {optimaSaving ? 'שומר...' : optimaConfig ? '✏️ עדכן' : '+ חבר'}
            </button>
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  )
}
