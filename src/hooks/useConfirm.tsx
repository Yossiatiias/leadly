'use client'

import { useCallback, useRef, useState } from 'react'

interface ConfirmOptions {
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  message: string
}

// חלונית אישור אחידה בעיצוב של המערכת, במקום window.confirm() המובנה
// בדפדפן — משמשת בכל מקום שבו עד כה השתמשנו ב-confirm() הגנרי (מחיקת
// ליד/קובץ/אינטראקציה, ביטול תור וכו'), כדי שגם פעולות הרסניות ייראו
// עקביות עם שאר האפליקציה ולא כמו חלונית זרה של הדפדפן
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((message: string, opts?: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve
      setState({ message, ...opts })
    })
  }, [])

  function respond(value: boolean) {
    resolveRef.current?.(value)
    resolveRef.current = null
    setState(null)
  }

  const ConfirmDialog = state ? (
    <div
      onClick={() => respond(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', direction: 'rtl' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: '16px', padding: '22px 24px', width: '360px', maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'var(--fg-1)', lineHeight: 1.6 }}>{state.message}</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => respond(true)}
            style={{
              flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
              background: state.danger === false ? 'var(--brand)' : '#E23E3E',
              color: 'white', fontWeight: 600, fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
            }}>
            {state.confirmLabel || 'אישור'}
          </button>
          <button
            onClick={() => respond(false)}
            style={{
              flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border-default)',
              background: 'var(--bg-sunken)', color: 'var(--fg-2)', fontWeight: 600, fontSize: '13px',
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
            {state.cancelLabel || 'ביטול'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, ConfirmDialog }
}
