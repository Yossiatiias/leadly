'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function AuthCallbackInner() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = searchParams.get('next') || '/onboarding'
    const supabase = createClient()

    async function handleCallback() {
      // Case 1: PKCE flow — code in query params
      const code = searchParams.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setError('שגיאת אימות. בקש הזמנה חדשה.')
          return
        }
        window.location.replace(next)
        return
      }

      // Case 2: Implicit flow — tokens in URL hash (handled automatically by Supabase client)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        window.location.replace(next)
        return
      }

      // Wait for Supabase to process hash fragment tokens
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
          subscription.unsubscribe()
          // Full page navigation ensures the session cookie is sent with the server request
          window.location.replace(next)
        }
      })

      // Timeout — if no session after 8 seconds, something went wrong
      setTimeout(() => {
        subscription.unsubscribe()
        setError('פג תוקף הקישור. בקש הזמנה חדשה מהמנהל.')
      }, 8000)
    }

    handleCallback()
  }, [])

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 16, padding: 24 }}>
        <p style={{ fontSize: 20 }}>⚠️</p>
        <p style={{ color: '#DC2626', fontSize: 15, fontWeight: 600, textAlign: 'center' }}>{error}</p>
        <a href="/login" style={{ color: 'var(--brand)', fontSize: 14 }}>חזור לדף הכניסה</a>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 16 }}>
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)' }} />
      <p style={{ color: 'var(--fg-3)', fontSize: 14 }}>מאמת את החשבון שלך... אנא המתן</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)' }} />
      </div>
    }>
      <AuthCallbackInner />
    </Suspense>
  )
}
