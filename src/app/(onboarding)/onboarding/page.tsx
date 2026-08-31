'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Wifi, WifiOff } from 'lucide-react'
import { greenApiUrl } from '@/lib/greenApi'

const STEPS = ['פרטי העסק', 'WhatsApp Business', 'הגדרות בוט', 'סיום'] as const

type Step = 0 | 1 | 2 | 3

interface BizForm  { name: string; phone: string; industry: string }
interface WAForm   { api_url: string; instance_id: string; api_token: string }
interface BotForm  { bot_name: string; greeting: string; goal: string }

const INDUSTRY_OPTIONS = [
  { value: 'dental',   label: 'רפואת שיניים' },
  { value: 'medical',  label: 'קליניקה רפואית' },
  { value: 'beauty',   label: 'יופי וטיפול עצמי' },
  { value: 'fitness',  label: 'כושר וספורט' },
  { value: 'legal',    label: 'משרד עו"ד' },
  { value: 'other',    label: 'אחר' },
]

const GOAL_OPTIONS = [
  { value: 'appointment', label: 'קביעת תור' },
  { value: 'lead',        label: 'השארת פרטים' },
  { value: 'info',        label: 'מתן מידע' },
  { value: 'sale',        label: 'מכירה ישירה' },
]

export default function OnboardingPage() {
  const supabase = createClient()
  const router = useRouter()
  const [step, setStep] = useState<Step>(0)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [biz, setBiz]  = useState<BizForm>({ name: '', phone: '', industry: 'medical' })
  const [wa, setWa]    = useState<WAForm>({ api_url: 'https://7107.api.greenapi.com', instance_id: '', api_token: '' })
  const [bot, setBot]  = useState<BotForm>({ bot_name: 'עוזר אונליין', greeting: '', goal: 'appointment' })
  const [waStatus, setWaStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('business_id').eq('id', user.id).single()

    if (!profile?.business_id) { router.push('/'); return }
    setBusinessId(profile.business_id)

    // Pre-fill business name
    const { data: bizData } = await supabase
      .from('businesses').select('name, settings').eq('id', profile.business_id).single()

    if (bizData?.settings?.onboarding_completed) { router.push('/'); return }

    if (bizData?.name) setBiz(b => ({ ...b, name: bizData.name }))
    if (bizData?.settings?.phone) setBiz(b => ({ ...b, phone: bizData.settings.phone }))
    if (bizData?.settings?.industry) setBiz(b => ({ ...b, industry: bizData.settings.industry }))
    if (bizData?.settings?.greeting) setBot(bt => ({ ...bt, greeting: bizData.settings.greeting }))
    if (bizData?.settings?.goal) setBot(bt => ({ ...bt, goal: bizData.settings.goal }))

    // Pre-fill bot greeting template
    if (!bizData?.settings?.greeting) {
      setBot(bt => ({
        ...bt,
        greeting: `שלום! אני ${bt.bot_name} של ${bizData?.name || 'הקליניקה'}.\nשמחים שפנית אלינו! 😊\nאיך נוכל לעזור לך היום?`,
      }))
    }

    setLoading(false)
  }

  async function saveStep0() {
    if (!biz.name.trim()) { setError('שם העסק הוא שדה חובה'); return false }
    setSaving(true); setError(null)
    const { data: existing } = await supabase.from('businesses').select('settings').eq('id', businessId!).single()
    const { error: err } = await supabase
      .from('businesses')
      .update({
        name: biz.name.trim(),
        settings: { ...(existing?.settings || {}), phone: biz.phone, industry: biz.industry },
      })
      .eq('id', businessId!)
    setSaving(false)
    if (err) { setError(err.message); return false }
    return true
  }

  async function testWhatsApp() {
    if (!wa.instance_id.trim() || !wa.api_token.trim()) {
      setError('מלא Instance ID ו-API Token לפני הבדיקה'); return
    }
    setWaStatus('testing'); setError(null)
    try {
      const url = greenApiUrl(wa.api_url, wa.instance_id, 'getStateInstance', wa.api_token)
      const res = await fetch(url)
      const json = await res.json()
      if (json.stateInstance === 'authorized') {
        setWaStatus('ok')
      } else {
        setWaStatus('fail')
        setError(`סטטוס WhatsApp: ${json.stateInstance || 'לא מחובר'} — ודא שהפעלת את ה-Instance וסרקת את ה-QR`)
      }
    } catch {
      setWaStatus('fail')
      setError('לא ניתן להתחבר ל-Green API — בדוק את הכתובת והפרטים')
    }
  }

  async function saveStep1() {
    if (waStatus !== 'ok') { setError('יש לבדוק את חיבור ה-WhatsApp לפני המשך'); return false }
    setSaving(true); setError(null)
    const { error: err } = await supabase
      .from('whatsapp_connections')
      .upsert({
        business_id: businessId!,
        instance_id: wa.instance_id.trim(),
        api_token: wa.api_token.trim(),
        api_url: wa.api_url.trim(),
        bot_enabled: true,
        status: 'active',
      }, { onConflict: 'business_id' })
    setSaving(false)
    if (err) { setError(err.message); return false }
    return true
  }

  async function saveStep2() {
    if (!bot.greeting.trim()) { setError('הוסף הודעת פתיחה לבוט'); return false }
    setSaving(true); setError(null)

    // Update businesses.settings with bot config
    const { data: bizData } = await supabase
      .from('businesses').select('settings').eq('id', businessId!).single()
    const settings = { ...(bizData?.settings || {}), greeting: bot.greeting, goal: bot.goal, bot_name: bot.bot_name }

    const { error: err } = await supabase
      .from('businesses').update({ settings }).eq('id', businessId!)
    setSaving(false)
    if (err) { setError(err.message); return false }
    return true
  }

  async function finishOnboarding() {
    setSaving(true); setError(null)
    const { data: bizData } = await supabase
      .from('businesses').select('settings').eq('id', businessId!).single()
    const settings = { ...(bizData?.settings || {}), onboarding_completed: true }
    await supabase.from('businesses').update({ settings }).eq('id', businessId!)
    setSaving(false)
    router.push('/')
  }

  // מדלג על חיבור הוואטסאפ בהקמה — אפשר לחבר בכל שלב מאוחר יותר דרך
  // הגדרות → חיבורים, אין סיבה לחסום את כל ההרשמה בגלל זה
  function skipWhatsAppStep() {
    setError(null)
    setStep(2)
  }

  async function goNext() {
    setError(null)
    let ok = true
    if (step === 0) ok = await saveStep0()
    if (step === 1) ok = await saveStep1()
    if (step === 2) ok = await saveStep2()
    if (ok) setStep(s => (s + 1) as Step)
  }

  function goBack() {
    setError(null)
    setStep(s => (s - 1) as Step)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)' }} />
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--brand)', letterSpacing: '-0.02em', margin: 0 }}>BetterLead</p>
          <p style={{ fontSize: 13, color: 'var(--fg-4)', margin: '4px 0 0' }}>הגדרת המערכת לעסק שלך</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
          {STEPS.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', border: '2px solid',
                borderColor: i < step ? '#16A34A' : i === step ? 'var(--brand)' : 'var(--border)',
                background: i < step ? '#16A34A' : i === step ? 'var(--brand)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}>
                {i < step
                  ? <CheckCircle2 size={14} color="white" />
                  : <span style={{ fontSize: 11, fontWeight: 700, color: i === step ? 'white' : 'var(--fg-4)' }}>{i + 1}</span>
                }
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 40, height: 2, background: i < step ? '#16A34A' : 'var(--border)', transition: 'background 0.2s' }} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '36px 40px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)', margin: '0 0 6px' }}>
            {STEPS[step]}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '0 0 28px' }}>
            {step === 0 && 'נתחיל עם פרטים בסיסיים על העסק שלך'}
            {step === 1 && 'חבר את מספר ה-WhatsApp Business של הקליניקה'}
            {step === 2 && 'הגדר איך הבוט יציג את עצמו ללקוחות'}
            {step === 3 && 'הגדרת המערכת הושלמה בהצלחה!'}
          </p>

          {/* Step 0: Business info */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="שם העסק *">
                <input value={biz.name} onChange={e => setBiz(b => ({ ...b, name: e.target.value }))}
                  placeholder="שקד קליניק" style={inputStyle} />
              </Field>
              <Field label="טלפון העסק">
                <input value={biz.phone} onChange={e => setBiz(b => ({ ...b, phone: e.target.value }))}
                  placeholder="050-0000000" style={inputStyle} dir="ltr" />
              </Field>
              <Field label="סוג עסק">
                <select value={biz.industry} onChange={e => setBiz(b => ({ ...b, industry: e.target.value }))} style={inputStyle}>
                  {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
          )}

          {/* Step 1: WhatsApp */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ padding: '14px 16px', borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1D4ED8', margin: '0 0 4px' }}>איך מקבלים את הפרטים?</p>
                <p style={{ fontSize: 12, color: '#3B82F6', margin: 0 }}>
                  נכנסים ל-<a href="https://green-api.com" target="_blank" rel="noreferrer" style={{ color: '#2563EB', fontWeight: 600 }}>green-api.com</a> ← פותחים instance ← בלשונית Profile תמצאו את ה-Instance ID ו-API Token
                </p>
              </div>
              <Field label="Green API URL">
                <input value={wa.api_url} onChange={e => { setWa(w => ({ ...w, api_url: e.target.value })); setWaStatus('idle') }}
                  placeholder="https://7107.api.greenapi.com" style={inputStyle} dir="ltr" />
              </Field>
              <Field label="Instance ID *">
                <input value={wa.instance_id} onChange={e => { setWa(w => ({ ...w, instance_id: e.target.value })); setWaStatus('idle') }}
                  placeholder="1234567890" style={inputStyle} dir="ltr" />
              </Field>
              <Field label="API Token *">
                <input value={wa.api_token} onChange={e => { setWa(w => ({ ...w, api_token: e.target.value })); setWaStatus('idle') }}
                  placeholder="abc123..." style={inputStyle} dir="ltr" type="password" />
              </Field>
              <button onClick={testWhatsApp} disabled={waStatus === 'testing'} style={{
                padding: '10px', borderRadius: 8, border: '1.5px solid',
                borderColor: waStatus === 'ok' ? '#16A34A' : waStatus === 'fail' ? '#DC2626' : 'var(--border)',
                background: 'transparent', color: waStatus === 'ok' ? '#16A34A' : waStatus === 'fail' ? '#DC2626' : 'var(--fg-2)',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                {waStatus === 'testing' && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                {waStatus === 'ok'      && <Wifi size={14} />}
                {waStatus === 'fail'    && <WifiOff size={14} />}
                {waStatus === 'idle'    && <Wifi size={14} />}
                {waStatus === 'testing' ? 'בודק חיבור...' : waStatus === 'ok' ? '✓ WhatsApp מחובר!' : 'בדוק חיבור'}
              </button>
              {waStatus !== 'ok' && (
                <button onClick={skipWhatsAppStep} style={{
                  background: 'none', border: 'none', color: 'var(--fg-3)', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline',
                  padding: 0, alignSelf: 'center',
                }}>
                  אדלג, אחבר וואטסאפ מאוחר יותר
                </button>
              )}
            </div>
          )}

          {/* Step 2: Bot */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="שם הבוט">
                <input value={bot.bot_name} onChange={e => setBotAndRefreshGreeting(e.target.value)}
                  placeholder="עוזר אונליין" style={inputStyle} />
              </Field>
              <Field label="מטרת הבוט">
                <select value={bot.goal} onChange={e => setBot(b => ({ ...b, goal: e.target.value }))} style={inputStyle}>
                  {GOAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="הודעת פתיחה ללקוחות *">
                <textarea value={bot.greeting} onChange={e => setBot(b => ({ ...b, greeting: e.target.value }))}
                  rows={5} placeholder="שלום! אני..." style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
              </Field>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#F0FDF4', border: '2px solid #16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <CheckCircle2 size={36} color="#16A34A" />
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)', margin: '0 0 8px' }}>הכל מוכן!</p>
              <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '0 0 24px', lineHeight: 1.6 }}>
                המערכת שלך מוגדרת ומוכנה לפעולה.<br />
                לקוחות שיפנו ל-WhatsApp שלך יקבלו מענה אוטומטי.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'right' }}>
                {[
                  { icon: '✓', text: 'פרטי העסק נשמרו' },
                  { icon: '✓', text: 'WhatsApp Business מחובר' },
                  { icon: '✓', text: 'בוט AI מוגדר ופעיל' },
                ].map(item => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: '#F0FDF4', color: '#16A34A', fontSize: 13, fontWeight: 500 }}>
                    <span style={{ fontWeight: 700 }}>{item.icon}</span>
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            {step > 0 && step < 3 && (
              <button onClick={goBack} style={{ padding: '11px 16px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--fg-2)', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronRight size={16} />
                אחורה
              </button>
            )}
            {step < 3 && (
              <button onClick={goNext} disabled={saving} style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: saving ? 'var(--fg-4)' : 'var(--brand)', color: 'white', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {saving
                  ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />שומר...</>
                  : <>{step === 2 ? 'שמור ועבור לסיום' : 'המשך'}<ChevronLeft size={16} /></>
                }
              </button>
            )}
            {step === 3 && (
              <button onClick={finishOnboarding} disabled={saving} style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: '#16A34A', color: 'white', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {saving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                כנס לדשבורד
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--fg-4)', marginTop: 20 }}>BetterLead © 2026</p>
      </div>
    </div>
  )

  function setBotAndRefreshGreeting(name: string) {
    setBot(b => ({
      ...b,
      bot_name: name,
      greeting: b.greeting.replace(/^אני .+? של/, `אני ${name} של`),
    }))
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1.5px solid var(--border)',
  fontSize: 14,
  fontFamily: 'inherit',
  background: 'var(--bg-surface)',
  color: 'var(--fg-1)',
  boxSizing: 'border-box',
}
