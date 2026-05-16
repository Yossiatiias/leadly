'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, FileBarChart, LogOut, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

const SIDEBAR_WIDTH = 260

const navItems = [
  { href: '/', label: 'תתחיל מכאן', icon: LayoutDashboard, desc: 'סדר עדיפויות' },
  { href: '/leads', label: 'כל הלידים', icon: Users, desc: 'ניהול וחיפוש' },
  { href: '/reports', label: 'דוחות', icon: FileBarChart, desc: 'נתונים וייצוא' },
]

export default function Sidebar({ profile }: { profile: Profile | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = profile?.full_name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <aside style={{
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: `${SIDEBAR_WIDTH}px`,
      background: '#256D85',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Sesya"
            style={{ height: '32px', width: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
          <div>
            <p style={{ fontWeight: 800, fontSize: '15px', color: 'white', lineHeight: 1.2 }}>Sesya</p>
            <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', fontWeight: 600, letterSpacing: '0.05em' }}>Lead Management</p>
          </div>
        </div>
        <Link href="/leads/new" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '10px', borderRadius: '10px', textDecoration: 'none',
          background: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 700, fontSize: '14px',
          border: '1.5px solid rgba(255,255,255,0.25)', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.25)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)' }}
        >
          <Plus size={15} />
          ליד חדש
        </Link>
      </div>

      {/* User */}
      <div style={{ margin: '0 12px 12px', padding: '12px', borderRadius: '12px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '9px',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 800, fontSize: '13px', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 700, color: 'white', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.full_name || 'משתמש'}</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginTop: '1px' }}>
              {profile?.role === 'admin' ? '👑 מנהל' : '💼 נציג מכירות'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {navItems.map(({ href, label, desc, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '12px',
              textDecoration: 'none',
              background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
              transition: 'background 0.15s',
              borderLeft: active ? '3px solid rgba(255,255,255,0.7)' : '3px solid transparent',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
              }}>
                <Icon size={16} style={{ color: active ? 'white' : 'rgba(255,255,255,0.6)' }} />
              </div>
              <div>
                <p style={{ fontWeight: 700, color: active ? 'white' : 'rgba(255,255,255,0.75)', fontSize: '13px', lineHeight: 1.3 }}>{label}</p>
                <p style={{ fontSize: '11px', color: active ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)', marginTop: '1px' }}>{desc}</p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={handleLogout} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', borderRadius: '10px', fontSize: '13px',
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)', transition: 'all 0.15s', fontFamily: 'inherit',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.15)'; (e.currentTarget as HTMLElement).style.color = '#FCA5A5' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)' }}
        >
          <LogOut size={15} />
          התנתקות
        </button>
      </div>
    </aside>
  )
}
