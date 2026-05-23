import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// Rate limiting: מניעת ספאם — מספר שניות בין תשובות לאותו מספר
const lastResponseTime: Map<string, number> = new Map()
const MIN_RESPONSE_INTERVAL_MS = 30_000 // 30 שניות מינימום בין תשובות

export async function POST(req: NextRequest) {
  try {
    const { conversationId, businessId, senderPhone, messageText, instanceId } = await req.json()

    // בדוק rate limit
    const lastTime = lastResponseTime.get(senderPhone)
    if (lastTime && Date.now() - lastTime < MIN_RESPONSE_INTERVAL_MS) {
      console.log(`Rate limited: ${senderPhone} — too soon since last response`)
      return NextResponse.json({ ok: true, skipped: 'rate_limited' })
    }

    // טען פרטי עסק + שאלות ותשובות
    const [{ data: business }, { data: qaItems }, { data: recentMessages }] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('qa_knowledge').select('question, answer, category').eq('business_id', businessId).eq('is_active', true),
      supabase.from('messages').select('direction, content, sender_type').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(10),
    ])

    // בנה היסטוריית שיחה
    const history = (recentMessages || [])
      .reverse()
      .map((m: { direction: string; content: string; sender_type: string }) => ({
        role: m.direction === 'inbound' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }))

    // בנה מאגר ידע
    const qaText = (qaItems || [])
      .map((qa: { question: string; answer: string }) => `ש: ${qa.question}\nת: ${qa.answer}`)
      .join('\n\n')

    // בנה רשימת שירותים
    const servicesText = (business?.settings?.services || [])
      .map((s: { name: string; price: string; duration: string; description: string }) =>
        `• ${s.name}${s.price ? ` — ${s.price}₪` : ''}${s.duration ? ` (${s.duration} דקות)` : ''}${s.description ? `: ${s.description}` : ''}`
      ).join('\n')

    const goalMap: Record<string, string> = {
      appointment: 'המטרה שלך היא לקבוע תור או פגישה עם הלקוח.',
      lead: 'המטרה שלך היא לאסוף את פרטי הלקוח (שם, טלפון) ולהבטיח שנציג יחזור אליו.',
      info: 'המטרה שלך היא לספק מידע מדויק על העסק והשירותים.',
      sale: 'המטרה שלך היא לסגור מכירה ישירה עם הלקוח.',
    }
    const goalText = goalMap[business?.settings?.goal || 'appointment'] || ''

    // System prompt
    const systemPrompt = `אתה נציג של "${business?.name || 'העסק'}".
אתה מתכתב עם לקוחות בוואטסאפ בצורה חמה, אנושית ומקצועית.
אתה ישראלי, כותב בעברית טבעית עם אימוג'ים מדי פעם.
${goalText}

פרטי העסק:
${business?.settings?.description || ''}
כתובת: ${business?.address || ''}
אתר: ${business?.website || ''}
שעות פעילות: ${business?.settings?.working_hours || ''}

${servicesText ? `שירותים ומחירים:\n${servicesText}` : ''}

מאגר שאלות ותשובות:
${qaText || 'אין מידע נוסף כרגע.'}

חוקים:
- ענה קצר וממוקד (2-3 משפטים מקסימום)
- אל תזכיר שאתה AI או בוט
- אם שאלו שאלה שאין לך תשובה עליה — אמור שתבדוק ותחזור
- אם הלקוח רוצה לקבוע — תציע זמנים ריאליים לשבוע הקרוב בהתאם לשעות הפעילות
- אחרי שנקבע תור — אשר ושאל אם יש עוד שאלות
${business?.settings?.escalation_rule ? `- ${business.settings.escalation_rule} — במקרה זה אמור "אעביר אותך לנציג שלנו"` : ''}`

    // קרא ל-Gemini
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    })

    const chat = model.startChat({ history: history.slice(0, -1) })
    const result = await chat.sendMessage(messageText)
    const aiResponse = result.response.text()

    if (!aiResponse) {
      return NextResponse.json({ ok: true })
    }

    // עיכוב אנושי לפני שליחה — מונע זיהוי כבוט (2-5 שניות אקראי)
    const humanDelay = 2000 + Math.floor(Math.random() * 3000)
    await new Promise(resolve => setTimeout(resolve, humanDelay))

    // שלח "מקליד..." לפני ההודעה
    const greenApiUrl = process.env.GREEN_API_URL
    const greenInstanceId = instanceId || process.env.GREEN_API_INSTANCE_ID
    const greenToken = process.env.GREEN_API_TOKEN

    // הצג אינדיקטור הקלדה
    await fetch(
      `${greenApiUrl}/waInstance${greenInstanceId}/showTyping/${greenToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${senderPhone}@c.us`, typeActivity: 'typing' }),
      }
    ).catch(() => {}) // לא קריטי אם נכשל

    // המתן עוד רגע בזמן "הקלדה"
    const typingDelay = 1000 + Math.floor(Math.random() * 2000)
    await new Promise(resolve => setTimeout(resolve, typingDelay))

    const sendResponse = await fetch(
      `${greenApiUrl}/waInstance${greenInstanceId}/sendMessage/${greenToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: `${senderPhone}@c.us`,
          message: aiResponse,
        }),
      }
    )

    if (!sendResponse.ok) {
      console.error('Failed to send WhatsApp message:', await sendResponse.text())
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // עדכן rate limit
    lastResponseTime.set(senderPhone, Date.now())

    // שמור את תשובת ה-AI
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      business_id: businessId,
      direction: 'outbound',
      content: aiResponse,
      sender_type: 'ai',
    })

    // עדכן שיחה
    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

    // צור ליד אם לא קיים
    await ensureLeadExists(conversationId, businessId, senderPhone)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('AI respond error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

async function ensureLeadExists(conversationId: string, businessId: string, phone: string) {
  const { data: conversation } = await supabase
    .from('conversations')
    .select('lead_id, contact_name')
    .eq('id', conversationId)
    .single()

  if (conversation?.lead_id) return

  // צור ליד חדש
  const { data: lead } = await supabase
    .from('leads')
    .insert({
      business_id: businessId,
      conversation_id: conversationId,
      phone,
      name: conversation?.contact_name || null,
      source: 'whatsapp',
      status: 'new',
    })
    .select()
    .single()

  if (lead) {
    await supabase
      .from('conversations')
      .update({ lead_id: lead.id })
      .eq('id', conversationId)
  }
}
