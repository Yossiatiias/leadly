'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('אימייל או סיסמה שגויים')
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #f0f9e8 0%, #e8f4fb 100%)' }}>
      {/* Left panel - branding */}
      <div className="hidden lg:flex w-1/2 flex-col justify-center items-center p-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, #7DC242 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }} />
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-8">
            <div className="relative w-32 h-24">
              <Image src="/logo.png" alt="Sesya" fill className="object-contain" />
            </div>
          </div>
          <h2 className="text-4xl font-bold text-[#3C3C3C] mb-4">Sesya Leads</h2>
          <p className="text-gray-500 text-lg max-w-xs">מערכת ניהול לידים חכמה לצוות המכירות של ססיה</p>
          <div className="mt-12 grid grid-cols-2 gap-4 text-right">
            {[
              { n: '100%', l: 'לידים מטופלים' },
              { n: '4', l: 'אנשי צוות' },
              { n: '3', l: 'ימי follow-up' },
              { n: '∞', l: 'פוטנציאל גדילה' },
            ].map(({ n, l }) => (
              <div key={l} className="bg-white/70 backdrop-blur rounded-2xl p-4 shadow-sm">
                <p className="text-2xl font-bold text-[#7DC242]">{n}</p>
                <p className="text-sm text-gray-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="relative w-24 h-16">
              <Image src="/logo.png" alt="Sesya" fill className="object-contain" />
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#3C3C3C]">ברוך הבא</h1>
              <p className="text-gray-400 text-sm mt-1">התחבר כדי לנהל את הלידים שלך</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">אימייל</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#7DC242]/40 focus:border-[#7DC242] transition-all bg-gray-50 focus:bg-white"
                  placeholder="your@email.com"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">סיסמה</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#7DC242]/40 focus:border-[#7DC242] transition-all bg-gray-50 focus:bg-white"
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-50 mt-2"
                style={{ background: 'linear-gradient(135deg, #7DC242, #5BB8E4)' }}
              >
                {loading ? 'מתחבר...' : 'כניסה למערכת'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">Sesya Lead Management System © 2026</p>
        </div>
      </div>
    </div>
  )
}
