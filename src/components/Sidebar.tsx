'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'
import { useEffect, useState } from 'react'

const navItems = [
  { href: '/',             label: 'בית'              },
  { href: '/conversations', label: 'שיחות'           },
  { href: '/leads',        label: 'לידים'            },
  { href: '/qa',           label: 'שאלות ותשובות'   },
  { href: '/connections',  label: 'חיבורים'          },
  { href: '/reports',      label: 'דוחות'            },
  { href: '/settings',     label: 'הגדרות עסק'       },
]

export default function Sidebar({ profile }: { profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [unread, setUnread] = useState(0)

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
      background: '#EBF5FA',
      borderLeft: '1px solid #C8E3F0',
      display: 'flex', flexDirection: 'column',
      zIndex: 20,
    }}>

      {/* Logo */}
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid #C8E3F0' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Sesya"
          style={{ width: '100%', maxWidth: '160px', height: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto', mixBlendMode: 'multiply' }}
        />
        <p style={{ textAlign: 'center', fontSize: '11px', color: '#5B8FA8', fontWeight: 500, marginTop: '8px', letterSpacing: '0.04em' }}>
          מערכת ניהול לידים
        </p>
      </div>

      {/* New lead button */}
      <div style={{ padding: '14px 16px 10px' }}>
        <Link href="/leads/new" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          padding: '10px', borderRadius: '10px', textDecoration: 'none',
          background: '#8DCB3F', color: 'white', fontWeight: 600, fontSize: '13px',
          boxShadow: '0 2px 6px rgba(141,203,63,0.35)', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#6FA82E' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#8DCB3F' }}
        >
          + ליד חדש
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {navItems.map(({ href, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          const showBadge = href === '/conversations' && unread > 0 && !active

          return (
            <Link key={href} href={href} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: '10px', textDecoration: 'none',
              background: active ? '#C8E3F0' : 'transparent',
              color: active ? '#1A4F6E' : '#3B6F8A',
              fontWeight: active ? 700 : 500,
              fontSize: '14px',
              transition: 'all 0.12s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#D6EDF8' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {label}
              {showBadge && (
                <span style={{
                  background: '#3FA9DC', color: 'white', borderRadius: '99px',
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

      {/* User + Logout */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #C8E3F0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px', padding: '9px 10px', borderRadius: '10px', background: '#D6EDF8' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: '#3FA9DC', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '11px', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 600, color: '#1A4F6E', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.full_name || 'משתמש'}
            </p>
            <p style={{ fontSize: '10px', color: '#5B8FA8', marginTop: '1px' }}>
              {profile?.role === 'admin' ? 'מנהל' : 'נציג מכירות'}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} style={{
          width: '100%', padding: '7px 10px', borderRadius: '8px', fontSize: '12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#7AAEC4', fontFamily: 'inherit', fontWeight: 500,
          textAlign: 'right', transition: 'all 0.12s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#C0392B'; (e.currentTarget as HTMLElement).style.background = '#FEF2F2' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#7AAEC4'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          התנתקות
        </button>
      </div>
    </aside>
  )
}
