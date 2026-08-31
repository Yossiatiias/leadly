import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import mammoth from 'mammoth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_CHARS = 24000 // הגבלת אורך כדי לא לנפח את הפרומפט

// העלאת מסמך הנחיות לבוט — התוכן נשמר ב-settings.agent_instructions
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const businessId = formData.get('business_id') as string

    if (!file || !businessId) {
      return NextResponse.json({ error: 'חסרים שדות' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())

    let content = ''
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer })
      content = result.value
    } else if (ext === 'txt' || ext === 'md') {
      content = buffer.toString('utf-8')
    } else {
      return NextResponse.json({ error: 'סוג קובץ לא נתמך — יש להעלות docx, txt או md' }, { status: 400 })
    }

    content = content.trim()
    if (!content) {
      return NextResponse.json({ error: 'הקובץ ריק או שלא ניתן לחלץ ממנו טקסט' }, { status: 400 })
    }
    if (content.length > MAX_CHARS) content = content.slice(0, MAX_CHARS)

    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', businessId).single()
    const existing = biz?.settings || {}

    const { error } = await supabase.from('businesses').update({
      settings: {
        ...existing,
        agent_instructions: content,
        agent_instructions_filename: file.name,
        agent_instructions_uploaded_at: new Date().toISOString(),
      },
    }).eq('id', businessId)

    if (error) throw error

    return NextResponse.json({ ok: true, filename: file.name, chars: content.length })
  } catch (err: unknown) {
    console.error('upload-instructions error:', err)
    const msg = err instanceof Error ? err.message : 'שגיאה בהעלאת הקובץ'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// הסרת מסמך ההנחיות
export async function DELETE(req: NextRequest) {
  try {
    const { business_id } = await req.json()
    if (!business_id) return NextResponse.json({ error: 'חסר business_id' }, { status: 400 })

    const { data: biz } = await supabase.from('businesses').select('settings').eq('id', business_id).single()
    const existing = { ...(biz?.settings || {}) }
    delete existing.agent_instructions
    delete existing.agent_instructions_filename
    delete existing.agent_instructions_uploaded_at

    const { error } = await supabase.from('businesses').update({ settings: existing }).eq('id', business_id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('remove-instructions error:', err)
    return NextResponse.json({ error: 'שגיאה בהסרת הקובץ' }, { status: 500 })
  }
}
