'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import { useEffect, useState } from 'react'
import { Moon, Sun, Home, MessageSquare, Users, CalendarDays, BarChart2, BookOpen, Plug2, Settings, Crosshair, type LucideIcon } from 'lucide-react'

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/',               label: 'בית',            icon: Home          },
  { href: '/conversations',  label: 'שיחות',          icon: MessageSquare },
  { href: '/leads',          label: 'ניהול לידים',    icon: Users         },
  { href: '/appointments',   label: 'יומן תורים',     icon: CalendarDays  },
  { href: '/analytics',      label: 'ניתוח ביצועים',  icon: BarChart2     },
  { href: '/lead-hunting',   label: 'ציד לידים',      icon: Crosshair     },
  { href: '/qa',             label: 'מידע ארגוני',    icon: BookOpen      },
  { href: '/connections',    label: 'חיבורים',        icon: Plug2         },
  { href: '/settings',       label: 'הגדרות עסק',     icon: Settings      },
]

export default function Sidebar({ profile }: { profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [unread, setUnread] = useState(0)
  const [dark, setDark] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

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
    <aside style={{
      position: 'fixed', right: 0, top: 0, bottom: 0,
      width: '240px',
      background: 'var(--sidebar-bg)',
      borderLeft: '1px solid var(--sidebar-border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 20,
      transition: 'background 0.2s, border-color 0.2s',
    }}>

      {/* Logo + theme toggle */}
      <div style={{ padding: '20px 16px 14px', borderBottom: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dark ? '/logo-dark.png' : '/logo-light.png'}
            alt="Leadly"
            style={{ width: '108px', height: 'auto', objectFit: 'contain', transition: 'all 0.2s', mixBlendMode: dark ? 'screen' : 'multiply' }}
          />
          <button onClick={toggleTheme} className="theme-toggle" title={dark ? 'מצב בהיר' : 'מצב כהה'}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--sidebar-subtitle)', fontWeight: 500, letterSpacing: '0.04em' }}>
          AI Lead Management
        </p>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          const showBadge = href === '/conversations' && unread > 0 && !active

          return (
            <Link
              key={href}
              href={href}
              className={`sidebar-link${active ? ' active' : ''}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <Icon size={16} style={{ flexShrink: 0 }} />
                {label}
              </span>
              {showBadge && (
                <span style={{
                  background: 'var(--sidebar-badge-bg)', color: 'white', borderRadius: '99px',
                  minWidth: '18px', height: '18px', padding: '0 5px',
                  fontSize: '10px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Client branding */}
      {(logoUrl || businessName) && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={businessName || 'לוגו עסק'}
              style={{ maxWidth: '120px', maxHeight: '48px', objectFit: 'contain', borderRadius: '6px' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          )}
          {businessName && (
            <div style={{ padding: '5px 10px', borderRadius: '8px', background: 'var(--brand-soft)', width: '100%', textAlign: 'center' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--brand)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {businessName}
              </p>
            </div>
          )}
        </div>
      )}

      {/* User + Logout */}
      <div style={{ padding: '12px 16px', borderTop: businessName ? 'none' : '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px', padding: '9px 10px', borderRadius: '10px', background: 'var(--sidebar-user-bg)' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'var(--brand)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '11px', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 600, color: 'var(--sidebar-user-fg)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.full_name || 'משתמש'}
            </p>
            <p style={{ fontSize: '10px', color: 'var(--sidebar-user-role)', marginTop: '1px' }}>
              {profile?.role === 'admin' ? 'מנהל' : 'נציג מכירות'}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} style={{
          width: '100%', padding: '7px 10px', borderRadius: '8px', fontSize: '12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--sidebar-logout-fg)', fontFamily: 'inherit', fontWeight: 500,
          textAlign: 'right', transition: 'all 0.12s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#EF4444'; (e.currentTarget as HTMLElement).style.background = dark ? '#2D1B1B' : '#FEF2F2' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--sidebar-logout-fg)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          התנתקות
        </button>
      </div>
    </aside>
  )
}
