'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import { useEffect, useState } from 'react'
import { Moon, Sun, Home, MessageSquare, Users, CalendarDays, BarChart2, BookOpen, Settings, Crosshair, HelpCircle, ShieldCheck, Menu, X, type LucideIcon } from 'lucide-react'

const navItems: { href: string; label: string; icon: LucideIcon; superadminOnly?: boolean }[] = [
  { href: '/',               label: 'בית',            icon: Home          },
  { href: '/conversations',  label: 'שיחות',          icon: MessageSquare },
  { href: '/leads',          label: 'מאגר פונים',     icon: Users         },
  { href: '/appointments',   label: 'יומן מרפאה',     icon: CalendarDays  },
  { href: '/analytics',      label: 'לוח בקרה',       icon: BarChart2     },
  { href: '/lead-hunting',   label: 'צייד לידים',     icon: Crosshair     },
  { href: '/qa',             label: 'ספרייה ארגונית', icon: BookOpen      },
  { href: '/qa/responses',   label: 'שאלות ותשובות',  icon: HelpCircle    },
  { href: '/settings',       label: 'הגדרות מרפאה',   icon: Settings      },
  { href: '/admin',          label: 'ניהול לקוחות',   icon: ShieldCheck,  superadminOnly: true },
]

export default function Sidebar({ profile }: { profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [unread, setUnread] = useState(0)
  const [dark, setDark] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  // סוגר את הסיידבר אוטומטית אם המסך גדל בחזרה לרוחב מחשב, כדי שלא
  // יישאר "פתוח" במצב הזה מסבב קודם במובייל
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth > 768) setMobileOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ניווט לעמוד חדש סוגר את הסיידבר במובייל
  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    if (!profile?.id) return
    async function loadBiz() {
      const { data: pr } = await supabase.from('profiles').select('business_id').eq('id', profile!.id).single()
      if (pr?.business_id) {
        const { data: biz } = await supabase.from('businesses').select('name, settings').eq('id', pr.business_id).single()
        if (biz?.name) setBusinessName(biz.name)
        if (biz?.settings?.logo_url) setLogoUrl(biz.settings.logo_url)
      }
    }
    loadBiz()
  }, [profile?.id])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('leadly-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('leadly-theme', 'light')
    }
  }

  useEffect(() => {
    if (!profile?.id) return
    async function loadUnread() {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', profile!.id)
        .is('read_at', null)
      setUnread(count || 0)
    }
    loadUnread()
    const ch = supabase.channel('sb-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        if ((p.new as any).receiver_id === profile!.id) setUnread(n => n + 1)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => loadUnread())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.id])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = profile?.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <>
      {/* כפתור המבורגר — מוצג רק במובייל (≤768px), הופך ל-X כשהסיידבר פתוח */}
      <button
        onClick={() => setMobileOpen(o => !o)}
        className="mobile-only"
        aria-label={mobileOpen ? 'סגור תפריט' : 'פתח תפריט'}
        style={{
          position: 'fixed', top: '14px', right: '14px', zIndex: 25,
          width: '38px', height: '38px', borderRadius: '10px',
          background: 'var(--sidebar-bg)', border: '1px solid var(--sidebar-border)',
          color: 'var(--sidebar-nav-fg)', cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* רקע כהה מאחורי הסיידבר הפתוח במובייל — לחיצה עליו סוגרת */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 15 }}
        />
      )}

      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`} style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: '220px',
        background: 'var(--sidebar-bg)',
        borderLeft: '1px solid var(--sidebar-border)',
        display: 'flex', flexDirection: 'column',
        zIndex: 20,
        transition: 'background 0.2s, border-color 0.2s, transform 0.25s ease',
      }}>

      {/* ── Header: Leadly logo + AI Management + theme toggle ── */}
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dark ? '/logo-dark.svg' : '/logo-light.svg'}
              alt="BetterLead"
              style={{ width: '130px', height: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
          </div>
          <button onClick={toggleTheme} className="theme-toggle" title={dark ? 'מצב בהיר' : 'מצב כהה'} style={{ flexShrink: 0 }}>
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>

        {/* Org logo — below Leadly branding */}
        {logoUrl && (
          <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: 'var(--sidebar-user-bg)', display: 'flex', justifyContent: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt={businessName || 'לוגו עסק'}
              style={{ height: '40px', maxWidth: '110px', objectFit: 'contain', borderRadius: '4px' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
      </div>

      {/* ── Nav ── */}
      <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.filter(item => !item.superadminOnly || profile?.role === 'superadmin').map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href + '/') && !navItems.some(item => item.href !== href && pathname.startsWith(item.href)))
          const showBadge = href === '/conversations' && unread > 0 && !active

          return (
            <Link key={href} href={href} className={`sidebar-link${active ? ' active' : ''}`}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon size={14} style={{ flexShrink: 0 }} />
                {label}
              </span>
              {showBadge && (
                <span style={{
                  background: 'var(--sidebar-badge-bg)', color: 'white', borderRadius: '99px',
                  minWidth: '16px', height: '16px', padding: '0 4px',
                  fontSize: '9px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* ── User ── */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', padding: '8px 10px', borderRadius: '10px', background: 'var(--sidebar-user-bg)' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'var(--brand)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '10px', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 500, color: 'var(--sidebar-user-fg)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.full_name || 'משתמש'}
            </p>
            {businessName && (
              <p style={{ fontSize: '10px', color: 'var(--sidebar-subtitle)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {businessName}
              </p>
            )}
          </div>
        </div>
        <button onClick={handleLogout} style={{
          width: '100%', padding: '6px 10px', borderRadius: '8px', fontSize: '11px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--sidebar-logout-fg)', fontFamily: 'inherit', fontWeight: 400,
          textAlign: 'right', transition: 'all 0.12s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#EF4444'; (e.currentTarget as HTMLElement).style.background = dark ? '#2D1B1B' : '#FEF2F2' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-logout-fg)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          התנתקות
        </button>
      </div>
      </aside>
    </>
  )
}
