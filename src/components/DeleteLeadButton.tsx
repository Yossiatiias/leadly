'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export default function DeleteLeadButton({ leadId }: { leadId: string }) {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleDelete() {
    setLoading(true)
    await supabase.from('leads').delete().eq('id', leadId)
    router.push('/leads')
    router.refresh()
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">בטוח למחוק?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? 'מוחק...' : 'כן, מחק'}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          ביטול
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="flex items-center gap-2 text-gray-400 hover:text-red-500 hover:bg-red-50 px-3 py-2 rounded-xl text-sm transition-all"
    >
      <Trash2 size={15} />
      מחק ליד
    </button>
  )
}
