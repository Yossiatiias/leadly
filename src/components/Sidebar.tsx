'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, FileBarChart, LogOut, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

const SIDEBAR_WIDTH = 240

const navItems = [
  { href: '/', label: 'התחל כאן', icon: LayoutDashboard, desc: 'סדר עדיפויות' },
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
      background: '#3730A3',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{ padding: '28px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px',
            background: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', padding: '5px', flexShrink: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Sesya" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <p style={{ fontWeight: 800, fontSize: '17px', color: 'white', lineHeight: 1.2 }}>Sesya</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 500, letterSpacing: '0.04em', marginTop: '1px' }}>Lead Management</p>
          </div>
        </div>

        {/* New lead button */}
        <Link href="/leads/new" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '11px', borderRadius: '10px', textDecoration: 'none',
          background: '#2563EB', color: 'white', fontWeight: 700, fontSize: '14px',
          boxShadow: '0 2px 8px rgba(37,99,235,0.4)',
          transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1D4ED8' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#2563EB' }}
        >
          <Plus size={15} />
          ליד חדש
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.map(({ href, label, desc, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '11px 14px',
              borderRadius: '10px',
              textDecoration: 'none',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <div style={{
                width: '34px', height: '34px', borderRadius: '9px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: active ? '#2563EB' : 'rgba(255,255,255,0.1)',
              }}>
                <Icon size={16} style={{ color: 'white' }} />
              </div>
              <div>
                <p style={{ fontWeight: 700, color: 'white', fontSize: '13px', lineHeight: 1.3 }}>{label}</p>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '1px' }}>{desc}</p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '9px',
            background: '#14B8A6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 800, fontSize: '12px', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 700, color: 'white', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.full_name || 'משתמש'}</p>
            <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', marginTop: '1px' }}>
              {profile?.role === 'admin' ? '👑 מנהל' : '💼 נציג מכירות'}
            </p>
          </div>
        </div>
        <button onClick={handleLogout} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.4)', transition: 'all 0.15s', fontFamily: 'inherit', fontWeight: 600,
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)'; (e.currentTarget as HTMLElement).style.color = '#FCA5A5' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
        >
          <LogOut size={14} />
          התנתקות
        </button>
      </div>
    </aside>
  )
}
