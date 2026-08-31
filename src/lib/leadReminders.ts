/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── ניקוי תזכורת אחרי יצירת קשר ─────────────────────────────────────────────
// כשנשלחת הודעה ללקוח, תזכורת שכבר בשלה נחשבת כבוצעה ויורדת מהרשימה.
// תזכורת עתידית (למשל לשבוע הבא) לא נוגעים בה — הודעה היום לא מבטלת אותה.
export async function clearDueReminder(sb: any, leadId: string | null | undefined): Promise<boolean> {
  if (!leadId) return false
  try {
    const { data: lead } = await sb
      .from('leads')
      .select('next_followup')
      .eq('id', leadId)
      .maybeSingle()

    if (!lead?.next_followup) return false
    if (new Date(lead.next_followup).getTime() > Date.now()) return false // עדיין עתידית

    const { error } = await sb.from('leads').update({ next_followup: null }).eq('id', leadId)
    if (error) {
      console.error('[clearDueReminder] update failed:', JSON.stringify(error))
      return false
    }
    console.log('[clearDueReminder] reminder cleared for lead', leadId)
    return true
  } catch (e) {
    console.error('[clearDueReminder] error:', e)
    return false
  }
}

// גרסה לפי conversation_id — שולפת את הליד המשויך ומנקה
export async function clearDueReminderByConversation(sb: any, conversationId: string): Promise<boolean> {
  try {
    const { data: conv } = await sb
      .from('conversations')
      .select('lead_id')
      .eq('id', conversationId)
      .maybeSingle()
    return clearDueReminder(sb, conv?.lead_id)
  } catch (e) {
    console.error('[clearDueReminderByConversation] error:', e)
    return false
  }
}
