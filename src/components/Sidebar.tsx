'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, FileBarChart, LogOut, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

const SIDEBAR_WIDTH = 280

const navItems = [
  { href: '/', label: 'היום שלי', icon: LayoutDashboard, desc: 'סדר עדיפויות' },
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
      background: '#13112a',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 20,
      overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{ padding: '28px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Sesya"
            style={{ height: '32px', width: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
          <div>
            <p style={{ fontWeight: 800, fontSize: '16px', color: 'white', lineHeight: 1.2 }}>Sesya</p>
            <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.05em' }}>Lead Management</p>
          </div>
        </div>
        <Link href="/leads/new" className="btn-primary flex items-center justify-center gap-2 w-full">
          <Plus size={16} />
          ליד חדש
        </Link>
      </div>

      {/* User */}
      <div style={{ margin: '0 16px 16px', padding: '14px', borderRadius: '16px', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="sesya-gradient" style={{ width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 'bold', color: 'white', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.full_name || 'משתמש'}</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
              {profile?.role === 'admin' ? '👑 מנהל' : '💼 נציג מכירות'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {navItems.map(({ href, label, desc, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '14px 16px',
              borderRadius: '16px',
              textDecoration: 'none',
              background: active ? 'linear-gradient(135deg, #7c3aed, #3b82f6)' : 'transparent',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)',
              }}>
                <Icon size={17} style={{ color: active ? 'white' : 'rgba(255,255,255,0.5)' }} />
              </div>
              <div>
                <p style={{ fontWeight: 'bold', color: active ? 'white' : 'rgba(255,255,255,0.7)', fontSize: '14px', lineHeight: 1.3 }}>{label}</p>
                <p style={{ fontSize: '11px', color: active ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)', marginTop: '2px' }}>{desc}</p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={handleLogout} style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 16px', borderRadius: '12px', fontSize: '14px',
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.35)', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; (e.currentTarget as HTMLElement).style.color = '#fca5a5' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
        >
          <LogOut size={16} />
          התנתקות
        </button>
      </div>
    </aside>
  )
}
