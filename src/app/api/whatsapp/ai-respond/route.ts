import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// סדר עדיפות סטטוסים — מניע קדימה בלבד
const STATUS_RANK: Record<string, number> = {
  new: 0, contacted: 1, in_progress: 2,
}

const MIN_RESPONSE_INTERVAL_MS = 30_000 // 30 שניות בין תשובות

export async function POST(req: NextRequest) {
  try {
    const { conversationId, businessId, senderPhone, messageText, instanceId } = await req.json()

    // ─── FIX 6: המתן 3 שניות לאיסוף הודעות מרובות מהירות ───────────────
    await new Promise(r => setTimeout(r, 3000))

    // ─── FIX 4: Rate limiting מ-DB (לא in-memory) ────────────────────────
    const { data: lastOutbound } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (lastOutbound) {
      const elapsed = Date.now() - new Date(lastOutbound.created_at).getTime()
      if (elapsed < MIN_RESPONSE_INTERVAL_MS) {
        console.log(`Rate limited: ${senderPhone} (${Math.round(elapsed / 1000)}s ago)`)
        return NextResponse.json({ ok: true, skipped: 'rate_limited' })
      }
    }

    // ─── FIX 6: אסוף את כל ההודעות הנכנסות מ-5 שניות אחרונות ──────────
    const batchSince = new Date(Date.now() - 5000).toISOString()
    const { data: batchMessages } = await supabase
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .gte('created_at', batchSince)
      .order('created_at', { ascending: true })

    const combinedText = batchMessages?.length
      ? batchMessages.map(m => m.content).join('\n')
      : messageText

    // ─── טען נתוני עסק + Q&A + היסטוריה ──────────────────────────────────
    const [{ data: business }, { data: qaItems }, { data: recentMessages }] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('qa_knowledge').select('question, answer').eq('business_id', businessId).eq('is_active', true),
      supabase.from('messages')
        .select('direction, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(14),
    ])

    const msgs = (recentMessages || []).reverse()

    // ─── FIX 1: בדוק אם זוהי ההחלפה הראשונה (בוט טרם ענה) ──────────────
    const isFirstExchange = !msgs.some(m => m.direction === 'outbound')

    const history = msgs.map(m => ({
      role: m.direction === 'inbound' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }))

    const qaText = (qaItems || [])
      .map(qa => `ש: ${qa.question}\nת: ${qa.answer}`)
      .join('\n\n')

    const servicesText = (business?.settings?.services || [])
      .map((s: { name: string; price?: string; duration?: string; description?: string }) =>
        `• ${s.name}${s.price ? ` — ${s.price}₪` : ''}${s.duration ? ` (${s.duration} דקות)` : ''}${s.description ? `: ${s.description}` : ''}`)
      .join('\n')

    const goalMap: Record<string, string> = {
      appointment: 'המטרה שלך היא לקבוע תור או פגישה עם הלקוח.',
      lead:        'המטרה שלך היא לאסוף פרטי לקוח ולהבטיח שנציג יחזור אליו.',
      info:        'המטרה שלך היא לספק מידע מדויק על העסק.',
      sale:        'המטרה שלך היא לסגור מכירה ישירה עם הלקוח.',
    }

    // ─── FIX 1: הוסף greeting לפרומפט בשיחה הראשונה ────────────────────
    const greetingLine = (isFirstExchange && business?.settings?.greeting)
      ? `\nהודעת פתיחה — השתמש בפתיח הזה: "${business.settings.greeting}"\n`
      : ''

    const systemPrompt = `אתה נציג של "${business?.name || 'העסק'}".
אתה מתכתב עם לקוחות בוואטסאפ בצורה חמה, אנושית ומקצועית.
אתה ישראלי, כותב עברית טבעית עם אימוג'ים מדי פעם.
${goalMap[business?.settings?.goal || 'appointment'] || ''}${greetingLine}

פרטי עסק:
${business?.settings?.description || ''}
כתובת: ${business?.address || ''} | אתר: ${business?.website || ''} | שעות: ${business?.settings?.working_hours || ''}
${servicesText ? `\nשירותים:\n${servicesText}` : ''}
${qaText ? `\nQ&A:\n${qaText}` : ''}

חוקים:
- ענה קצר וממוקד (2-3 משפטים)
- אל תזכיר שאתה AI או בוט
- אם אין לך תשובה — "אבדוק ואחזור אליך"
- אם הלקוח רוצה לקבוע — הצע זמנים ריאליים לפי שעות הפעילות
${business?.settings?.escalation_rule ? `- ${business.settings.escalation_rule} — אמור "אעביר אותך לנציג שלנו"` : ''}`

    // ─── קרא ל-Gemini ─────────────────────────────────────────────────────
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
    })

    const chat = model.startChat({ history: history.slice(0, -1) })
    const result = await chat.sendMessage(combinedText)
    const aiResponse = result.response.text()

    if (!aiResponse) return NextResponse.json({ ok: true })

    // ─── עיכוב אנושי ──────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 3000)))

    const greenApiUrl   = process.env.GREEN_API_URL
    const greenInstance = instanceId || process.env.GREEN_API_INSTANCE_ID
    const greenToken    = process.env.GREEN_API_TOKEN
    const chatId        = `${senderPhone}@c.us`

    // אינדיקטור הקלדה
    await fetch(
      `${greenApiUrl}/waInstance${greenInstance}/showTyping/${greenToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, typeActivity: 'typing' }) }
    ).catch(() => {})

    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)))

    // ─── שלח הודעה ────────────────────────────────────────────────────────
    const sendRes = await fetch(
      `${greenApiUrl}/waInstance${greenInstance}/sendMessage/${greenToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: aiResponse }) }
    )

    if (!sendRes.ok) {
      console.error('Send failed:', await sendRes.text())
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // ─── שמור הודעה יוצאת ─────────────────────────────────────────────────
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      business_id:     businessId,
      direction:       'outbound',
      content:         aiResponse,
      sender_type:     'ai',
    })

    await supabase.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    // ─── צור ליד אם לא קיים ───────────────────────────────────────────────
    await ensureLeadExists(conversationId, businessId, senderPhone)

    // ─── FIX 2+3+5: ניתוח שיחה לעדכון טמפרטורה/סטטוס/שם (async) ─────────
    const allMsgs = [...msgs, { direction: 'outbound', content: aiResponse }]
    analyzeAndUpdateLead(conversationId, senderPhone, allMsgs).catch(console.error)

    return NextResponse.json({ ok: true })

  } catch (error) {
    console.error('AI respond error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ─── יצירת ליד ראשוני ─────────────────────────────────────────────────────────
async function ensureLeadExists(conversationId: string, businessId: string, phone: string) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('lead_id, contact_name')
    .eq('id', conversationId)
    .single()

  if (conv?.lead_id) return

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      business_id:     businessId,
      conversation_id: conversationId,
      phone,
      name:        conv?.contact_name || phone,
      source:      'whatsapp',
      status:      'new',
      temperature: 'cold',
    })
    .select()
    .single()

  if (lead) {
    await supabase.from('conversations')
      .update({ lead_id: lead.id })
      .eq('id', conversationId)
  }
}

// ─── FIX 2+3+5: ניתוח שיחה — טמפרטורה, סטטוס, שם ────────────────────────────
async function analyzeAndUpdateLead(
  conversationId: string,
  phone: string,
  messages: { direction: string; content: string }[]
) {
  try {
    if (messages.length < 2) return

    const convoText = messages
      .map(m => `${m.direction === 'inbound' ? 'לקוח' : 'בוט'}: ${m.content}`)
      .join('\n')

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const result = await model.generateContent(
      `נתח את שיחת הוואטסאפ הבאה עם לקוח פוטנציאלי. ענה אך ורק ב-JSON תקין, ללא טקסט נוסף.

שיחה:
${convoText}

פורמט תשובה בלבד:
{"name":null,"temperature":"cold","status":"new"}

כללים:
- name: שם פרטי בלבד אם הלקוח הציג את עצמו בבירור, אחרת null
- temperature:
  hot    = הלקוח ביטא עניין ברור / שאל על מחיר / תור / זמינות / אמר שרוצה להתקדם
  medium = פנה ושוחח אבל לא גילה עניין ממשי
  cold   = שאלה כללית בלבד
- status:
  new         = הודעה ראשונה, הבוט טרם ענה
  contacted   = הבוט ענה לפחות פעם אחת
  in_progress = 3+ הודעות ויש עניין מצד הלקוח`
    )

    const raw = result.response.text().trim()
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return

    const analysis = JSON.parse(match[0]) as {
      name: string | null
      temperature: string
      status: string
    }

    // מצא ליד
    const { data: conv } = await supabase
      .from('conversations')
      .select('lead_id')
      .eq('id', conversationId)
      .single()

    if (!conv?.lead_id) return

    const { data: lead } = await supabase
      .from('leads')
      .select('name, status, temperature')
      .eq('id', conv.lead_id)
      .single()

    const updates: Record<string, string> = {}

    // טמפרטורה: תמיד עדכן (יכולה לעלות ולרדת)
    if (analysis.temperature && ['hot', 'medium', 'cold'].includes(analysis.temperature))
      updates.temperature = analysis.temperature

    // סטטוס: רק התקדמות קדימה — אף פעם לא נסיגה
    if (
      analysis.status &&
      STATUS_RANK[analysis.status] !== undefined &&
      STATUS_RANK[analysis.status] > (STATUS_RANK[lead?.status ?? 'new'] ?? 0)
    ) updates.status = analysis.status

    // שם: רק אם אין שם אמיתי עדיין (כלומר הטלפון שמור כשם)
    if (analysis.name && (!lead?.name || lead.name === phone))
      updates.name = analysis.name

    if (Object.keys(updates).length > 0)
      await supabase.from('leads').update(updates).eq('id', conv.lead_id)

    // עדכן גם שם בשיחה
    if (analysis.name && (!lead?.name || lead.name === phone))
      await supabase.from('conversations').update({ contact_name: analysis.name }).eq('id', conversationId)

  } catch (e) {
    console.error('analyzeAndUpdateLead error:', e)
  }
}
