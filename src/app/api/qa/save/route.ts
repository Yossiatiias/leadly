import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, business_id, question, answer, category, audience } = body

    if (!business_id || !question?.trim()) {
      return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 })
    }

    if (id) {
      const { error } = await supabase.from('qa_knowledge').update({
        question,
        answer: answer || '',
        category: category || 'כללי',
        audience: audience || 'both',
      }).eq('id', id)
      if (error) throw error
    } else {
      if (!answer?.trim()) {
        return NextResponse.json({ error: 'חסרים שדות חובה' }, { status: 400 })
      }
      const { error } = await supabase.from('qa_knowledge').insert({
        business_id,
        type: 'qa',
        question,
        answer,
        category: category || 'כללי',
        audience: audience || 'both',
        is_active: true,
      })
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('qa save error:', err)
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'חסר ID' }, { status: 400 })
    const { error } = await supabase.from('qa_knowledge').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || JSON.stringify(err) }, { status: 500 })
  }
}
