import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Called by leadly-scout — receives pre-classified posts directly (no Apify)
export async function POST(req: NextRequest) {
  try {
    const { business_id, posts } = await req.json()
    if (!business_id || !Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: 'חסרים פרמטרים' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('lead_candidates')
      .select('source_link')
      .eq('business_id', business_id)
      .not('source_link', 'is', null)

    const existingLinks = new Set((existing || []).map((r: any) => r.source_link))

    let saved = 0
    for (const post of posts) {
      if (!post.text || existingLinks.has(post.postUrl)) continue

      await supabase.from('lead_candidates').insert({
        business_id,
        source_url: post.postUrl,
        source_link: post.postUrl,
        source_name: post.groupName,
        summary: post.summary || null,
        name: post.name || null,
        raw_text: post.text.slice(0, 2000),
        status: 'pending',
      })

      existingLinks.add(post.postUrl)
      saved++
    }

    return NextResponse.json({ ok: true, saved })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'שגיאה' }, { status: 500 })
  }
}
