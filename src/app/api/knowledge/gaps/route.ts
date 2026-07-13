import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

const service = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET — list gaps for business
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('business_id').eq('id', user.id).single()
    if (!profile?.business_id) return NextResponse.json({ gaps: [] })

    const status = req.nextUrl.searchParams.get('status') || 'open'

    const query = service
      .from('knowledge_gaps')
      .select('*')
      .eq('business_id', profile.business_id)
      .order('asked_count', { ascending: false })
      .order('last_asked_at', { ascending: false })

    if (status !== 'all') query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ gaps: data || [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — log a new gap (called from ai-respond with service role)
export async function POST(req: NextRequest) {
  try {
    const { business_id, question, conversation_id } = await req.json()
    if (!business_id || !question) return NextResponse.json({ ok: false })

    const clean = question.trim().slice(0, 500)

    // check if same question already exists
    const { data: existing } = await service
      .from('knowledge_gaps')
      .select('id, asked_count')
      .eq('business_id', business_id)
      .ilike('question', clean)
      .eq('status', 'open')
      .maybeSingle()

    if (existing) {
      await service.from('knowledge_gaps').update({
        asked_count: existing.asked_count + 1,
        last_asked_at: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      await service.from('knowledge_gaps').insert({
        business_id, question: clean, conversation_id,
        status: 'open', asked_count: 1,
        last_asked_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH — resolve or ignore a gap
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, status, answer, audience, category } = await req.json()
    if (!id || !status) return NextResponse.json({ error: 'Missing id/status' }, { status: 400 })

    const { data: { user: u } } = await supabase.auth.getUser()
    const { data: profile } = await supabase
      .from('profiles').select('business_id').eq('id', u!.id).single()

    const updates: Record<string, unknown> = {
      status,
      resolved_at: new Date().toISOString(),
    }
    if (answer) {
      updates.resolved_answer = answer
      updates.resolved_audience = audience || 'both'
    }

    await service.from('knowledge_gaps').update(updates).eq('id', id)

    // if resolved with answer → add to knowledge base
    if (status === 'resolved' && answer && profile?.business_id) {
      const { data: gap } = await service
        .from('knowledge_gaps').select('question').eq('id', id).single()

      await service.from('qa_knowledge').insert({
        business_id: profile.business_id,
        type: 'qa',
        question: gap?.question || 'שאלה',
        answer,
        category: category || 'כללי',
        audience: audience || 'both',
        is_active: true,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
