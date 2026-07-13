import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const businessId = formData.get('business_id') as string
    const title    = formData.get('title') as string
    const audience = (formData.get('audience') as string) || 'both'
    const category = (formData.get('category') as string) || 'קבצים'

    if (!file || !businessId) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    const safeName = file.name
      .replace(/[^\w.\-]/g, '_')   // replace any non-ASCII / special chars with _
      .replace(/_+/g, '_')          // collapse consecutive underscores
    const fileName = `${businessId}/${Date.now()}_${safeName}`

    // העלה לסופאבייס Storage
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const { error: uploadError } = await supabase.storage
      .from('knowledge-files')
      .upload(fileName, buffer, { contentType: file.type, upsert: false })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage
      .from('knowledge-files')
      .getPublicUrl(fileName)

    // חילוץ טקסט בסיסי לפי סוג קובץ
    let content = ''
    if (ext === 'txt') {
      content = Buffer.from(bytes).toString('utf-8')
    } else if (ext === 'csv') {
      content = Buffer.from(bytes).toString('utf-8')
    } else {
      // PDF/Word — שמור שם הקובץ כ-content (חילוץ מלא בשלב הבא עם pdf-parse)
      content = `[קובץ: ${file.name}] — תוכן זמין להורדה`
    }

    const { data, error } = await supabase
      .from('qa_knowledge')
      .insert({
        business_id:  businessId,
        type:         'file',
        title:        title || file.name,
        question:     title || file.name,
        answer:       content,
        content,
        file_url:     publicUrl,
        category,
        audience,
        is_active:    true,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, item: data })
  } catch (err) {
    console.error('knowledge upload error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
