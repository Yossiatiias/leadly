/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── יצירת ליד ראשוני עבור שיחה ─────────────────────────────────────────────
// שותף בין webhook.ts (חייב ליד לפני שמירת קובץ, גם כשהבוט כבוי/human_takeover)
// לבין ai-respond.ts (חייב ליד לפני שמירת תור/ניתוח). מחזיר את מזהה הליד —
// הקיים אם כבר יש, או החדש שנוצר כרגע.
// ─── זיהוי מקור מ"פנייה בקליק" (Click to WhatsApp) של פייסבוק/אינסטגרם ──────
// מודעות כאלה שולחות כהודעה הראשונה טקסט קבוע-מראש מטה. אין webhook/API
// נפרד לזהות את זה — הדרך היחידה היא להכיר את הניסוח הקבוע של מטא בהודעה עצמה
function detectAdSource(firstMessageText: string | null | undefined): string | null {
  if (!firstMessageText) return null
  if (firstMessageText.includes('דרך המודעה באינסטגרם')) return 'instagram'
  if (firstMessageText.includes('דרך המודעה בפייסבוק')) return 'facebook'
  return null
}

// ─── פיצול שם מלא לשם פרטי ושם משפחה — משותף לכל נקודות יצירת הליד ──────────
// (וואטסאפ, ציד לידים, backoffice, הוספה ידנית) כדי שעמודת "שם משפחה"
// בטבלת הלידים לא תישאר ריקה
export function splitName(fullName: string | null | undefined): { firstName: string; lastName: string | null } {
  const trimmed = (fullName || '').trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx > 0) {
    return { firstName: trimmed.slice(0, spaceIdx), lastName: trimmed.slice(spaceIdx + 1) }
  }
  return { firstName: trimmed, lastName: null }
}

export async function ensureLeadExists(
  sb: any, conversationId: string, businessId: string, phone: string, firstMessageText?: string | null
): Promise<string | null> {
  const { data: conv } = await sb
    .from('conversations')
    .select('lead_id, contact_name')
    .eq('id', conversationId)
    .single()

  if (conv?.lead_id) return conv.lead_id

  const fullName = conv?.contact_name || phone
  const { firstName, lastName } = splitName(conv?.contact_name || phone)

  const { data: lead } = await sb
    .from('leads')
    .insert({
      business_id:     businessId,
      conversation_id: conversationId,
      phone,
      name:        fullName,
      first_name:  firstName,
      last_name:   lastName,
      source:      detectAdSource(firstMessageText) || 'whatsapp',
      status:      'new',
      temperature: 'cold',
    })
    .select()
    .single()

  if (lead) {
    await sb.from('conversations')
      .update({ lead_id: lead.id })
      .eq('id', conversationId)
    return lead.id
  }
  return null
}

// ─── עדכון סטטוס אוטומטי מוגן — האמת היחידה לכלל "סטטוס שנבחר ידנית ────────
// לעולם לא משתנה כתוצאה מאירוע טכני" (יוסי, 30/08) ────────────────────────
// קרה בפועל פעמיים בשני נתיבים נפרדים: (1) הבוט קידם סטטוס אוטומטית גם
// כשהוא כבר נבחר ידנית (quote_followup וכו') — תוקן ב-computeLeadUpdates.
// (2) מסך היומן דרס סטטוסים ידניים בחזרה ל-published/in_progress בכל
// פתיחת עמוד / יצירת תור / מחיקת תור — כי כל אחד מהם עדכן status ישירות
// בלי לבדוק בכלל מה הסטטוס הנוכחי. הפונקציה הזו היא הנקודה היחידה
// שמבצעת בפועל UPDATE לסטטוס "אוטומטי" (לא בבחירת משתמש מפורשת) —
// טוענת את הסטטוס הנוכחי **טרי מה-DB** (לא מ-state בזיכרון שעלול להיות
// ישן) ומעדכנת רק אם הוא נמצא ברשימת allowedFromStatuses שהקורא מעביר.
// מחזירה true אם בוצע עדכון בפועל
export async function promoteLeadStatusIfAutoManaged(
  sb: any, leadId: string, targetStatus: string, allowedFromStatuses: readonly string[]
): Promise<boolean> {
  const { data: lead } = await sb.from('leads').select('status').eq('id', leadId).maybeSingle()
  if (!lead || !allowedFromStatuses.includes(lead.status)) return false
  const { error } = await sb.from('leads').update({ status: targetStatus }).eq('id', leadId)
  return !error
}
