import { NextRequest } from 'next/server'

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`

async function askGemini(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })
  const json = await res.json()
  console.log('Gemini response:', JSON.stringify(json, null, 2))
  if (json.error) throw new Error(json.error.message)
  return json.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

export async function POST(req: NextRequest) {
  const { type, data } = await req.json()
  let prompt = ''

  if (type === 'script') {
    prompt = `אתה עוזר מכירות של ססיה — פלטפורמה להשכרת קליניקות וחדרי טיפול בישראל.

פרטי הליד:
שם: ${data.name}
חברה/מתחם: ${data.company_name || 'לא ידוע'}
מקור: ${data.source}
סטטוס: ${data.status}
הערות: ${data.notes || 'אין'}
היסטוריית אינטראקציות: ${data.history || 'אין עדיין'}

כתוב תסריט שיחה קצר ואנושי בעברית. כלול:
1. פתיחה חמה ואישית (1-2 משפטים)
2. שאלת בירור אחת ממוקדת
3. הצעת ערך אחת רלוונטית לליד הזה

חשוב: כתוב בגוף ראשון, בטון אנושי, ישיר ולא רובוטי. לא יותר מ-8 שורות.`
  }

  else if (type === 'summary') {
    prompt = `אתה עוזר מכירות של ססיה. סכם שיחת מכירות בעברית בצורה מקצועית וקצרה.

מה דיווח הנציג: "${data.notes}"
תוצאת השיחה: ${data.outcome}
ליד: ${data.name}

כתוב סיכום מקצועי בפסקה אחת קצרה (3-4 משפטים) שיסביר לכל מי שיקרא אותו בעתיד:
- מה קרה בשיחה
- מה עמדת הליד
- מה הצעד הבא`
  }

  else if (type === 'objection') {
    prompt = `אתה מאמן מכירות מומחה לפלטפורמת ססיה (השכרת קליניקות).

הנציג נתקל בהתנגדות: "${data.objection}"
רקע על הליד: ${data.context || 'לא ידוע'}

תן 2-3 תגובות אפשריות קצרות ואנושיות בעברית. לכל תגובה — משפט אחד בלבד. לא רובוטי, לא תסריטאי.`
  }

  else if (type === 'insights') {
    prompt = `אתה מנהל מכירות של ססיה. נתח את נתוני הנציג והפק תובנה אחת מועילה.

נתוני הנציג היום:
- סה"כ לידים: ${data.total}
- שיחות שבוצעו: ${data.calls}
- התקדמו: ${data.progressed}
- לידים חמים שלא טופלו: ${data.hotUntreated}

כתוב תובנה אחת ממוקדת ומועילה בעברית (2-3 משפטים). ספציפי, לא גנרי.`
  }

  const text = await askGemini(prompt)
  return Response.json({ text })
}
