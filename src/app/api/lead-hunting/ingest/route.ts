import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const DENTAL_KEYWORDS = [
  'שן', 'שיניים', 'שינה', 'רופא שיניים', 'דנטלי',
  'השתלה', 'השתלות', 'שיקום', 'הלבנה', 'ציפוי', 'ציפויים',
  'כתר', 'כתרים', 'גשר', 'יישור', 'אורתודנט', 'סד',
  'עקירה', 'טיפול שורש', 'חניכיים', 'implant', 'dental',
]

function mightBeRelevant(text: string): boolean {
  const lower = text.toLowerCase()
  return DENTAL_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

async function classifyWithAI(text: string): Promise<{ isLead: boolean; summary: string; name: string | null }> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const prompt = `אתה מסייע לקליניקת שיניים לזהות לידים פוטנציאליים מפוסטים בפייסבוק.
ליד פוטנציאלי = מישהו שמחפש טיפול שיניים, שואל המלצות על רופא שיניים, או מתעניין בטיפול ספציפי.
לא ליד = מכירת ציוד, מאמרים כלליים, הצעות עבודה, פרסומות, שאלות לא קשורות לשיניים.

ענה בפורמט JSON בלבד (ללא markdown):
{"isLead": true/false, "summary": "תיאור קצר בעברית של מה מחפש האדם (עד 15 מילים)", "name": "שם האדם אם מוזכר או null"}

הפוסט:
${text.slice(0, 1000)}`

    const result = await model.generateContent(prompt)
    const content = result.response.text().trim()
    const json = JSON.parse(content.replace(/```json?|```/g, '').trim())
    return {
      isLead: !!json.isLead,
      summary: json.summary || '',
      name: json.name || null,
    }
  } catch {
    return { isLead: false, summary: '', name: null }
  }
}

// Called by Apify webhook when a run succeeds
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const businessId = searchParams.get('business_id')
    if (!businessId) return NextResponse.json({ error: 'חסר business_id' }, { status: 400 })

    const body = await req.json()

    // Apify webhook payload: body.resource.defaultDatasetId
    const datasetId = body?.resource?.defaultDatasetId
    if (!datasetId) return NextResponse.json({ error: 'חסר datasetId' }, { status: 400 })

    // Fetch items from Apify dataset
    const apifyRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_API_TOKEN}&limit=100`,
      { signal: AbortSignal.timeout(30000) }
    )
    if (!apifyRes.ok) return NextResponse.json({ error: 'שגיאה בשליפת נתונים מ-Apify' }, { status: 500 })

    const items: any[] = await apifyRes.json()

    // Fetch existing source_links to avoid duplicates
    const { data: existing } = await supabase
      .from('lead_candidates')
      .select('source_link')
      .eq('business_id', businessId)
      .not('source_link', 'is', null)

    const existingLinks = new Set((existing || []).map((r: any) => r.source_link))

    let saved = 0
    for (const item of items) {
      const text: string = item.text || item.message || item.postText || ''
      const url: string = item.url || item.postUrl || item.link || ''
      const groupName: string = item.groupName || item.pageName || ''
      const authorName: string = item.authorName || item.name || null

      if (!text || existingLinks.has(url)) continue
      if (!mightBeRelevant(text)) continue

      const { isLead, summary, name } = await classifyWithAI(text)
      if (!isLead) continue

      await supabase.from('lead_candidates').insert({
        business_id: businessId,
        source_url: url,
        source_link: url,
        source_name: groupName,
        summary,
        name: name || authorName || null,
        raw_text: text.slice(0, 2000),
        status: 'pending',
      })

      existingLinks.add(url)
      saved++
    }

    return NextResponse.json({ ok: true, processed: items.length, saved })
  } catch (err: any) {
    console.error('ingest error:', err)
    return NextResponse.json({ error: err?.message || 'שגיאה' }, { status: 500 })
  }
}
