import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  saveOrRescheduleBotAppointment, extractApptFromText,
  normalizeApptDate, israelDateTime,
  resolveRelativeDayOffset, findRelativeDayOffsetInHistory, israelDateISOOffset,
  looksLikeSchedulingReply, extractOfferedDateTime, hasQualifiedDoctorOnDate, findAvailableDoctorForExactSlot,
  findAvailableSlots, findNextAvailableSlots, resolveActiveRequestedDate,
  type BotApptResult,
} from '@/lib/botAppointments'
import { clearDueReminderByConversation } from '@/lib/leadReminders'
import { greenApiUrl as buildGreenApiUrl, cleanInstanceId } from '@/lib/greenApi'
import { ensureLeadExists } from '@/lib/leads'
import { parseBotTags, buildApptErrorMessage, buildApptConfirmationSummary, computeLeadUpdates, matchServiceReason, resolveActiveService, resolveActiveServiceAnchor, extractEscalationFromText, extractMentionedDoctorId, extractCustomerRequestedDoctorId, textMentionsWrongDoctor, textStatesWrongDate, israelDateOnly, NO_AVAILABILITY_MESSAGE, looksLikeAvailabilityInquiry, extractAllTimesInText, extractAllDateTimePairsInText, buildSafeSlotResponse, buildSafeExactSlotResponse, botAskedAboutScheduling, looksLikeSchedulingTopicShift, type LeadAnalysis } from '@/lib/botTags'
import { updateGenderNameState, buildGenderInstructionBlock, looksLikeFreshLeadOpener, type ConversationGenderState } from '@/lib/genderName'
import { createOptimaAppointment, toOptimaConfig, resolveOptimaCardId } from '@/lib/optima'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function geminiChat(systemPrompt: string, history: {role: string, content: string}[], userMessage: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ],
      max_tokens: 600,
      // 0.4 ולא 0.7: זה בוט שנותן מחירים, שעות ופרטים רפואיים-אדמיניסטרטיביים
      // בפועל — עדיפה עקביות ודיוק גבוה על פני יצירתיות, גם אם המחיר הוא
      // מעט פחות "וריאציה" בניסוח בין הודעה להודעה
      temperature: 0.4,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ─── פורמט שעות פעילות לפרומפט ──────────────────────────────────────────────
// מסך ההגדרות שומר את הטבלה תחת settings.working_hours_table (מבנה יומי מלא).
// זהו השדה היחיד שבאמת מתמלא מהממשק — אין דבר אחר שכותב שעות פעילות.
function formatWorkingHours(table: { day: string; open: string; close: string; closed: boolean }[] | undefined): string {
  if (!table?.length) return ''
  const groups: { days: string[]; label: string }[] = []
  for (const d of table) {
    const label = d.closed ? 'סגור' : `${d.open}-${d.close}`
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.days.push(d.day)
    else groups.push({ days: [d.day], label })
  }
  return groups
    .map(g => `${g.days.length > 1 ? `${g.days[0]}-${g.days[g.days.length - 1]}` : g.days[0]}: ${g.label}`)
    .join(', ')
}

const MIN_RESPONSE_INTERVAL_MS = 5_000 // 5 שניות בין תשובות

// שיחה ננעלת עד TTL הזה גם אם קריאה קודמת קרסה/נתקעה בלי לשחרר —
// אחרת שיחה שתקועה בנעילה לעולם לא תקבל תשובה יותר
const PROCESSING_LOCK_TTL_MS = 30_000

export async function POST(req: NextRequest) {
  try {
    const { conversationId, businessId, senderPhone, messageText } = await req.json()

    // ─── נעילת עיבוד לשיחה — מונע שתי קריאות מקבילות על אותה שיחה ─────────
    // קרה בפועל: לקוח ששלח 2 הודעות תוך פחות משנייה גרם לשתי קריאות
    // ai-respond מקבילות, כל אחת קבעה תור/רופא בנפרד — הלקוח קיבל שתי
    // הודעות סותרות, והתור שנשמר בסוף נשאר בלי רופא משויך בכלל. UPDATE...WHERE
    // אטומי ב-Postgres: רק קריאה אחת יכולה "לתפוס" את השיחה בכל רגע נתון
    const { data: claimed, error: claimError } = await supabase
      .from('conversations')
      .update({ ai_processing_started_at: new Date().toISOString() })
      .eq('id', conversationId)
      .or(`ai_processing_started_at.is.null,ai_processing_started_at.lt.${new Date(Date.now() - PROCESSING_LOCK_TTL_MS).toISOString()}`)
      .select('id')
      .maybeSingle()

    // אם העמודה עדיין לא קיימת ב-DB (המיגרציה טרם רצה) — נכשלים "פתוח":
    // עדיף שהבוט ימשיך לענות בלי הגנת המרוץ, מאשר שיפסיק לענות לגמרי לכולם
    if (claimError) {
      console.error('[ai-respond] processing-lock claim errored — proceeding without lock:', claimError.message)
    } else if (!claimed) {
      console.log('[ai-respond] another invocation is already processing this conversation — skipping:', conversationId)
      return NextResponse.json({ ok: true, skipped: 'already_processing' })
    }

    try {
      let response = await handleAiRespond(conversationId, businessId, senderPhone, messageText)

      // ─── לא לתת להודעת לקוח "להיעלם" ────────────────────────────────────
      // קרה בפועל (30/08, רחל מוגרבי): הריצה הראשונה עדיין מעבדת, הלקוחה
      // שולחת הודעה נוספת — היא לא יכולה לתפוס את הנעילה (עדיין תפוסה)
      // ולא לעבור את ה-rate-limit (תשובה נשלחה זה עתה), אז ה-webhook שלה
      // פשוט מדלג ומחזיר בלי לעשות כלום. ההודעה נשארת ב-DB אבל אף ריצה
      // לא באמת עונה עליה. כאן, אחרי שהריצה שכן תפסה את הנעילה מסיימת,
      // בודקים אם הצטברה הודעה שה-batch שלה לא ראה בכלל — ואם כן, ממשיכים
      // לעבד אותה **באותה נעילה בדיוק** (בלי לשחרר ולתפוס מחדש), עד שאין
      // יותר מה לתפוס. זה שומר על "ריצה אחת בכל רגע" (אין קריאות מקבילות)
      // תוך כדי שאף הודעה לא נשארת בלי מענה
      for (let guard = 0; guard < 5; guard++) {
        const { data: conv } = await supabase.from('conversations').select('ai_last_batch_at').eq('id', conversationId).maybeSingle()
        const cursor = conv?.ai_last_batch_at
        if (!cursor) break // אין מידע על batch קודם (למשל המיגרציה טרם רצה) — לא ממשיכים לנחש

        const { data: pendingRows } = await supabase.from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('direction', 'inbound')
          .gt('created_at', cursor)

        if (!pendingRows?.length) break // אין הודעות ממתינות — סיימנו

        console.log('[ai-respond] follow-up pass — inbound message(s) arrived while a previous pass was still processing:', JSON.stringify({ conversationId, cursor, pendingCount: pendingRows.length }))
        response = await handleAiRespond(conversationId, businessId, senderPhone, '', { sinceOverride: cursor, skipGates: true })
      }

      return response
    } finally {
      await supabase.from('conversations').update({ ai_processing_started_at: null }).eq('id', conversationId)
    }
  } catch (error) {
    console.error('AI respond error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ─── קורא-המשך (follow-up pass) בתוך אותה ריצה נעולה ────────────────────────
// options.sinceOverride: אם קיים, ה-batch מסתכל אחורה **עד התאריך הזה בדיוק**
// (לא "5 שניות אחורה מעכשיו") — כדי לתפוס בוודאות הודעות שהגיעו תוך כדי
// שהריצה הקודמת עדיין עיבדה, גם אם עברו הרבה יותר מ-5 שניות מאז שהן נשלחו.
// options.skipGates: מדלג על ההמתנה המלאכותית (1500ms) ועל בדיקת ה-rate-limit
// — אלה נועדו למנוע טריגר כפול על אותה הודעה מ-webhook נפרד, לא רלוונטיים
// כשאנחנו כבר בטוחים (כאן, מה-caller) שיש הודעת לקוח אמיתית שממתינה לעיבוד
async function handleAiRespond(
  conversationId: string, businessId: string, senderPhone: string, messageText: string,
  options: { sinceOverride?: string; skipGates?: boolean } = {}
) {
  {
    if (!options.skipGates) {
      // ─── FIX 6: המתן לאיסוף הודעות מרובות מהירות (קוצר מ-3 שניות ל-1.5) ──
      await new Promise(r => setTimeout(r, 1500))

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
    }

    // ─── FIX 6: אסוף את כל ההודעות הנכנסות מ-5 שניות אחרונות (או, בריצת-המשך,
    // מאז ה-cursor המדויק שהועבר — ראה sinceOverride למעלה) ──────────────
    // sinceOverride הוא ה-created_at של ההודעה **האחרונה שכבר טופלה** בריצה
    // הקודמת — לכן משתמשים כאן ב-gt (חד-משמעית אחריה), לא gte, כדי לא לכלול
    // מחדש הודעה שכבר נענתה יחד עם התוכן החדש שממתין
    const batchSince = options.sinceOverride || new Date(Date.now() - 5000).toISOString()
    let batchQuery = supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: true })
    batchQuery = options.sinceOverride ? batchQuery.gt('created_at', batchSince) : batchQuery.gte('created_at', batchSince)
    const { data: batchMessages } = await batchQuery

    const combinedText = batchMessages?.length
      ? batchMessages.map(m => m.content).join('\n')
      : messageText

    // שומרים עד היכן ה-batch הזה הסתכל — כך שאחרי שהריצה הזו תסתיים, ה-POST
    // handler יכול לבדוק בוודאות אם הגיעה הודעה שהיא **לא** ראתה בכלל,
    // ולעבד אותה מיד באותה נעילה, במקום שהיא "תיעלם" (ראה יוסי, 30/08 —
    // רחל מוגרבי: הודעה שנייה נשלחה תוך כדי שהריצה הראשונה עדיין עיבדה,
    // ומעולם לא קיבלה עיבוד עצמאי משלה — לא ע"י lock ולא ע"י rate-limit)
    if (batchMessages?.length) {
      const lastBatchedAt = batchMessages[batchMessages.length - 1].created_at
      await supabase.from('conversations').update({ ai_last_batch_at: lastBatchedAt }).eq('id', conversationId)
    }

    // ─── טען נתוני עסק + Q&A + היסטוריה + מצב מגדר/שם של השיחה ────────────
    const [{ data: business }, { data: qaItems }, { data: recentMessages }, { data: convGenderRow }] = await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase.from('qa_knowledge').select('type, question, answer, source_url').eq('business_id', businessId).eq('is_active', true).or('audience.eq.customer,audience.eq.both,audience.is.null'),
      supabase.from('messages')
        .select('direction, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(14),
      supabase.from('conversations')
        .select('gender_state, gender_confidence, gender_evidence, verified_first_name, verified_first_name_source')
        .eq('id', conversationId)
        .maybeSingle(),
    ])

    const msgs = (recentMessages || []).reverse()

    // ─── זיהוי מגדר/שם — שכבה דטרמיניסטית, רצה לפני בניית הפרומפט ──────────
    // לא תלויה במודל: קובעת מראש מה מותר לו לכתוב, במקום לבקש ממנו "לנחש".
    // ברירת המחדל היא תמיד unknown — מתעדכן רק על בסיס רמז חד-משמעי, ולעולם
    // לא דורס זיהוי חזק (הצהרה מפורשת) בזיהוי חלש יותר. ראה src/lib/genderName.ts
    const currentGenderState: ConversationGenderState = {
      gender_state: (convGenderRow?.gender_state as ConversationGenderState['gender_state']) || 'unknown',
      gender_confidence: convGenderRow?.gender_confidence ?? null,
      gender_evidence: convGenderRow?.gender_evidence ?? null,
      verified_first_name: convGenderRow?.verified_first_name ?? null,
      verified_first_name_source: (convGenderRow?.verified_first_name_source as ConversationGenderState['verified_first_name_source']) ?? null,
    }
    const { next: genderState, changed: genderStateChanged } = updateGenderNameState(currentGenderState, combinedText)
    if (genderStateChanged) {
      // לוג פנימי בלבד — לא מוצג ללקוח — לצורך אבחון עתידי
      console.log('gender_detection:', JSON.stringify({
        state: genderState.gender_state, confidence: genderState.gender_confidence, evidence: genderState.gender_evidence,
        name_source: genderState.verified_first_name_source,
      }))
      await supabase.from('conversations').update({
        gender_state: genderState.gender_state,
        gender_confidence: genderState.gender_confidence,
        gender_evidence: genderState.gender_evidence,
        verified_first_name: genderState.verified_first_name,
        verified_first_name_source: genderState.verified_first_name_source,
      }).eq('id', conversationId)
    }
    // קרה בפועל: מספר טלפון עם שם שמור מלפני שבועות פתח שיחה חדשה-נראית
    // ("הגעתי דרך המודעה") והבוט פתח מיד עם השם הישן — למרות שאין ודאות
    // שהמידע עדיין נכון. מדכאים שימוש בשם רק אם הוא **לא** הוזן מחדש
    // בהודעה הנוכחית עצמה (verified_first_name זהה למה שהיה לפני העדכון
    // של ההודעה הזו) — אם הלקוח כתב שם חדש באותה הודעה, זה מידע טרי, לא ישן
    const isReintroduction = looksLikeFreshLeadOpener(combinedText)
      && !!currentGenderState.verified_first_name
      && currentGenderState.verified_first_name === genderState.verified_first_name
    const genderInstructionBlock = buildGenderInstructionBlock(genderState, isReintroduction)

    // ─── FIX 1: בדוק אם זוהי ההחלפה הראשונה (בוט טרם ענה) ──────────────
    const isFirstExchange = !msgs.some(m => m.direction === 'outbound')

    const history = msgs.map(m => ({
      role: m.direction === 'inbound' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }))

    const qaText = (qaItems || []).map(item => {
      if (item.type === 'file') return `[מסמך: ${item.question}]\n${item.answer}`
      if (item.type === 'url') return `[מאתר ${item.source_url || item.question}]\n${item.answer}`
      return `ש: ${item.question}\nת: ${item.answer}`
    }).join('\n\n---\n\n')

    const servicesText = (business?.settings?.services || [])
      .filter((s: { active?: boolean }) => s.active !== false)
      .map((s: { name: string; price?: string; duration?: string; notes?: string }) =>
        `• ${s.name}${s.notes ? ` (${s.notes})` : ''}${s.price ? ` — ${s.price}₪` : ''}${s.duration ? ` — ${s.duration} דקות` : ''}`)
      .join('\n')

    const s = business?.settings || {}
    const workingHoursText = formatWorkingHours(s.working_hours_table)

    // Business exceptions (closed dates)
    const exceptions: {date: string; reason: string}[] = s.business_exceptions || []
    const upcomingClosed = exceptions
      .filter((e: {date: string}) => e.date >= new Date().toISOString().slice(0, 10))
      .sort((a: {date: string}, b: {date: string}) => a.date.localeCompare(b.date))
      .slice(0, 10)
    const closedDatesText = upcomingClosed.length > 0
      ? '\nתאריכים שהעסק סגור (אל תציע בהם תורים!):\n' +
        upcomingClosed.map((e: {date: string; reason: string}) => `${e.date}${e.reason ? ' — ' + e.reason : ''}`).join('\n')
      : ''

    // Employee responsibilities — who handles which service
    const empResponsibilities: Record<string, string[]> = s.employee_responsibilities || {}
    const employeeSchedulesForPrompt: Record<string, { day: string; closed: boolean }[]> = s.employee_schedules || {}
    const employeeMinLeadHours: Record<string, number> = s.employee_min_lead_hours || {}
    let staffText = ''
    // נשאר בהיקף חיצוני ל-if — נדרש גם בשלב קביעת התור (preferredDoctorId)
    // ולעיגון תשובות חופשיות מול שם רופא/ה אמיתי, לא רק לבניית הפרומפט.
    // נטען תמיד (לא רק כש-empResponsibilities מוגדר) — עסק עם עובדים אבל
    // בלי שיוך שירותים עדיין צריך שהעיגון-נגד-הזיות יעבוד
    const profileMap: Record<string, string> = {}
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('business_id', businessId)
    for (const p of allProfiles || []) profileMap[p.id] = p.full_name || 'עובד'
    if (Object.keys(empResponsibilities).length > 0) {
      // ימי העבודה האישיים של כל רופא/ה (נפרד משעות הפעילות הכלליות של
      // העסק) — קרה בפועל: לקוח ביקש יום שהעסק פתוח בו, אבל הרופא/ה
      // היחיד/ה שמטפל/ת בשירות המבוקש לא עובד/ת באותו יום בכלל, והבוט
      // אישר את היום כי ראה רק את שעות הפעילות הכלליות. בלי המידע הזה
      // בפרומפט, אין למודל שום דרך לדעת זאת.
      const workDaysLine = (uid: string): string => {
        const sched = employeeSchedulesForPrompt[uid]
        if (!sched?.length) return ''
        const openDays = sched.filter(d => !d.closed).map(d => d.day)
        return openDays.length > 0 ? ` (עובד/ת בימים: ${openDays.join(', ')})` : ''
      }
      const minLeadLine = (uid: string): string => {
        const h = employeeMinLeadHours[uid]
        return h ? ` (דרוש מינימום ${h} שעות מראש לתיאום תור אצלו/ה)` : ''
      }
      const lines = Object.entries(empResponsibilities)
        .filter(([, svcs]) => svcs.length > 0)
        .map(([uid, svcs]) => `${profileMap[uid] || uid}: ${(svcs as string[]).join(', ')}${workDaysLine(uid)}${minLeadLine(uid)}`)
      if (lines.length > 0)
        staffText = '\nשיוך שירותים לרופאים:\n' + lines.join('\n') +
          '\n(הצע תורים רק עם הרופא שמטפל בשירות המבוקש, וביום שהוא/היא בפועל עובד/ת — גם אם העסק פתוח, ייתכן שהרופא/ה הספציפי/ת לא נמצא/ת באותו יום)'
    }

    // ─── תור קיים ללקוח — עובדה קרקעית לפרומפט, לא ניחוש ────────────────────
    // קרה בפועל (25/08, לימור): לקוחה עם תור אמיתי ביומן (מסונכרן מאופטימה)
    // שאלה "תזכירי לי מתי קבענו" — הבוט לא קיבל שום מידע על התור הקיים
    // שלה, ובלית ברירה כתב משפט "לא מצאתי תור זמין" (ניסוח שאמור לשמש רק
    // כשבאמת אין זמינות לתור **חדש**) — תשובה שגויה לגמרי כשבפועל יש לה
    // תור מחר. בלי המידע הזה בפרומפט, אין למודל שום דרך לענות נכון על
    // "מתי התור שלי" חוץ מלנחש/להמציא — בדיוק סוג ההזיה שהחוקים למטה
    // אוסרים. עכשיו: אם קיים תור עתידי, הוא מוזרק כעובדה מוכנה.
    //
    // חובה לחפש לפי patient_phone (הטלפון האמיתי בשיחה), לא לפי lead_id
    // (יוסי, 25/08: "הוא חייב לחפש ליטרלי ביומן לפי שם/טלפון") — תורים
    // שסונכרנו מאופטימה נשמרים לפעמים עם lead_id ריק (sync-optima/route.ts:
    // מקשר ליד רק אם הוא כבר קיים באותו רגע), ותור יכול גם להשתנות/להיווצר
    // ביומן עצמו בכל רגע. חיפוש חי ב-DB לפי טלפון בכל הודעה (לא זיכרון
    // שיחה, לא lead_id) הוא הדרך היחידה שמובטחת לשקף את המצב האמיתי ביומן
    let existingApptText = ''
    {
      const { data: apptRow } = await supabase.from('appointments')
        .select('scheduled_at, treatment_type, assigned_to')
        .eq('business_id', businessId)
        .eq('patient_phone', senderPhone)
        .in('status', ['scheduled', 'confirmed'])
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (apptRow) {
        const apptDate = new Date(apptRow.scheduled_at)
        const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(apptDate)
        const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(apptDate)
        const [y, m, d] = dateStr.split('-')
        const doctorName = apptRow.assigned_to ? profileMap[apptRow.assigned_to] : null
        existingApptText = `\nללקוח הזה כבר יש תור קבוע: ${d}.${m}.${y} בשעה ${timeStr}${apptRow.treatment_type ? `, ${apptRow.treatment_type}` : ''}${doctorName ? `, אצל ${doctorName}` : ''}. אם הלקוח שואל מתי התור שלו / מבקש תזכורת — ציין בדיוק את הפרטים האלה, אל תמציא ואל תשנה תאריך/שעה.`
      }
    }

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

    // תאריכים בשעון ישראל — היסט דינמי (קיץ +3 / חורף +2), לא קבוע!
    let isrOffsetH = 3
    try {
      const tzPart = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
        .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''
      const om = tzPart.match(/([+-]\d+)/)
      if (om) isrOffsetH = parseInt(om[1])
    } catch { /* fallback +3 */ }
    const israelOffset = isrOffsetH * 60 * 60 * 1000
    const israelNow = new Date(Date.now() + israelOffset)

    // בנה רשימת ימי השבוע הקרובים (14 ימים) לפרומפט — למנוע חישובי תאריך שגויים של המודל
    const HEB_DAY_NAMES_PROMPT = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
    const upcomingDatesText = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(israelNow.getTime() + i * 86400000)
      const iso = d.toISOString().slice(0, 10)
      const dayName = HEB_DAY_NAMES_PROMPT[d.getUTCDay()]
      const [y, m, day] = iso.split('-')
      return `יום ${dayName} ${day}/${m}/${y} = ${iso}`
    }).join('\n')

    // ─── FIND AVAILABLE SLOTS — "מתי פנוי?"/"מה יש בשלישי?" ────────────────
    // (יוסי, 01/09): עד כה המערכת ידעה רק לאמת שעה ספציפית שכבר ניתנה
    // (עיגון הצעה למטה) — לא לענות בעצמה "אילו שעות יש". כשלקוח ביקש
    // "תרשום לי מתי פנוי" בלי לתת שעה, ל-LLM לא היה שום מקור אמת לענות,
    // ובלית ברירה נפל תמיד להעברה לנציג — גם כשבפועל היו שעות פנויות.
    // כאן: אם ההודעה נראית כשאלת-זמינות כללית, מחשבים מראש שעות אמיתיות
    // מהיומן ומזריקים אותן כעובדה קשיחה לפרומפט — ה-LLM לא "מנחש", רק בוחר
    // איך לנסח את מה שכבר חושב. הוולידציה שאף שעה שלא ברשימה לא תישלח
    // בפועל היא **אחרי** הגנרציה, למטה (איפה שגם שאר עיגון ההצעות רץ)
    let availableSlotsBlock = ''
    let computedSlotsThisTurn: { date: string; time: string; doctorId: string }[] | null = null
    // GENERAL NEXT AVAILABLE ("מתי יש לכם?", בלי יום ספציפי) — נפרד בכוונה
    // מ-computedSlotsThisTurn (יום בודד, ראה למעלה): כשיש כמה תאריכים
    // אפשריים באותה תשובה, אימות "השעה קיימת איפשהו ברשימה" לא מספיק —
    // אותה שעה יכולה להיות אמיתית ביום אחד ומומצאת באחר. נשמר עם date+time
    // צמודים כדי לאמת זוגות שלמים, לא רק שעות בודדות (ראה עיגון למטה)
    let nextAvailableBlock = ''
    let computedNextAvailableSlots: { date: string; time: string; doctorId: string }[] | null = null
    // ─── זיהוי הקשרי (STAGE 1A, יוסי 01/09) — ROOT CAUSE, לא עוד ביטוי ──────
    // קרה בפועל: הבוט שאל "יש לך העדפה לתאריך או שעה?", הלקוח ענה "מתי
    // אפשר?" — looksLikeAvailabilityInquiry לא זיהתה את זה (לא "פנוי", לא
    // ברשימת הביטויים), כל הבלוק דולג, וה-LLM ענה בלי grounding בכלל.
    // הפתרון: לא עוד ביטוי-אחר-ביטוי אצל הלקוח — במקום זה, אם ה-**בוט**
    // עצמו שאל על תאריך/שעה/זמינות בהודעתו האחרונה (אוצר מילים קטן ויציב,
    // כי זה הניסוח שלנו, לא של אינספור לקוחות), כל תגובה של הלקוח שלא
    // עוברת בבירור לנושא אחר (מחיר/מיקום/זהות רופא) נחשבת המשך לאותה
    // שיחת-תזמון. משתמש רק ב-msgs שכבר קיימים — אין state חדש
    const lastOutboundMessage = [...msgs].reverse().find(m => m.direction === 'outbound')?.content || ''
    const isAvailabilityContextContinuation =
      botAskedAboutScheduling(lastOutboundMessage) && !looksLikeSchedulingTopicShift(combinedText)
    if (looksLikeAvailabilityInquiry(combinedText) || isAvailabilityContextContinuation) {
      const requestedDate = resolveActiveRequestedDate(combinedText, msgs, israelNow)
      // אין עדיין תגית LEAD לתור הזה (טרם קרינו ל-LLM) — משתמשים רק
      // בעדיפות 2 של resolveActiveService (סריקת הודעות נכנסות אחורה),
      // בדיוק כמו שעיגון ההצעה למטה עושה כש-inlineReason חסר. sinceIndex
      // (יוסי, 01/09, FIX 1) מגביל את חיפוש "רופא מבוקש" להודעות מאז
      // שהשירות הפעיל הזה נקבע — לא לכל היסטוריית השיחה (ר' resolveActiveServiceAnchor)
      const { service: inquiryService, sinceIndex: serviceAnchorIndex } = resolveActiveServiceAnchor(null, msgs, business?.settings?.services || [])
      if (requestedDate && inquiryService) {
        const preferredDoctorIdForInquiry = extractCustomerRequestedDoctorId(msgs, profileMap, serviceAnchorIndex)
        const matchedInquirySvc = (business?.settings?.services || []).find((sv: { name: string; duration?: string | number }) => sv.name?.includes(inquiryService))
        const inquiryDuration = matchedInquirySvc?.duration ? parseInt(String(matchedInquirySvc.duration)) : 60
        const slots = await findAvailableSlots(
          supabase, businessId,
          requestedDate, inquiryService,
          business?.settings?.employee_responsibilities || {},
          business?.settings?.employee_schedules || {},
          business?.settings?.employee_min_lead_hours || {},
          isNaN(inquiryDuration) ? 60 : inquiryDuration,
          preferredDoctorIdForInquiry,
          4,
          s.working_hours_table,
        )
        computedSlotsThisTurn = slots
        const [dy, dm, dd] = requestedDate.split('-')
        if (slots.length > 0) {
          const slotsText = slots.map(sl => `${sl.time}${profileMap[sl.doctorId] ? ` (${profileMap[sl.doctorId]})` : ''}`).join(', ')
          availableSlotsBlock = `\nזמינות אמיתית ב-${dd}.${dm}.${dy}: ${slotsText}\n**חובה**: הלקוח שאל על זמינות/שעות פנויות — הצג לו אך ורק שעות מתוך הרשימה הזו (אפשר לבחור 2-4 מהן, אין צורך להציג את כולן). אסור להוסיף, לשנות או להמציא שעה שלא מופיעה כאן, גם אם היא נשמעת סבירה.`
        } else {
          availableSlotsBlock = `\nלא נמצאה זמינות אמיתית ב-${dd}.${dm}.${dy} לשירות המבוקש. הלקוח שאל על זמינות/שעות פנויות — אל תמציא שעה. אמור בעדינות שלא מצאת תור זמין (ראה הניסוח הקבוע בחוקים למטה) ושתעביר את הבקשה לנציג.`
        }
      } else if (inquiryService) {
        // ─── GENERAL NEXT AVAILABLE — "מתי יש לכם?"/"מתי פנוי?" ───────────
        // (יוסי, 01/09): קרה בפועל — לקוח ביקש "מתי יש לכם?" בלי לתת יום,
        // ולבוט לא הייתה שום יכולת לחפש קדימה, אז נפל תמיד לברירת המחדל
        // הישנה ("לא מצאתי תור זמין") גם כשבפועל הייתה זמינות תוך ימים
        // ספורים. סורקים 14 יום קדימה (אותו טווח כבר מוצג ל-LLM בלוח
        // התאריכים למטה — upcomingDatesText — כך שאין כאן אופק חדש שהמודל
        // לא מכיר, ומספיק כדי לתפוס גם רופא/ה שעובד/ת רק יום-יומיים בשבוע)
        const NEXT_AVAILABLE_SEARCH_DAYS = 14
        const preferredDoctorIdForInquiry = extractCustomerRequestedDoctorId(msgs, profileMap, serviceAnchorIndex)
        const matchedInquirySvc = (business?.settings?.services || []).find((sv: { name: string; duration?: string | number }) => sv.name?.includes(inquiryService))
        const inquiryDuration = matchedInquirySvc?.duration ? parseInt(String(matchedInquirySvc.duration)) : 60
        const todayISO = israelNow.toISOString().slice(0, 10)
        const slots = await findNextAvailableSlots(
          supabase, businessId,
          todayISO, NEXT_AVAILABLE_SEARCH_DAYS, inquiryService,
          business?.settings?.employee_responsibilities || {},
          business?.settings?.employee_schedules || {},
          business?.settings?.employee_min_lead_hours || {},
          isNaN(inquiryDuration) ? 60 : inquiryDuration,
          preferredDoctorIdForInquiry,
          4,
          s.working_hours_table,
        )
        computedNextAvailableSlots = slots
        if (slots.length > 0) {
          const slotsText = slots.map(sl => {
            const [yy, mm, dd] = sl.date.split('-')
            return `${dd}.${mm}.${yy} ${sl.time}${profileMap[sl.doctorId] ? ` (${profileMap[sl.doctorId]})` : ''}`
          }).join(', ')
          nextAvailableBlock = `\nהתורים הפנויים הקרובים ביותר בפועל (${NEXT_AVAILABLE_SEARCH_DAYS} הימים הקרובים): ${slotsText}\n**חובה**: הלקוח שאל על זמינות כללית בלי לציין יום — הצג לו אך ורק אפשרויות מתוך הרשימה הזו (2-4 מהן). לכל אפשרות ציין תאריך מלא בפורמט DD.MM.YYYY בדיוק כפי שמופיע כאן, צמוד לשעה. אסור להוסיף, לשנות או להמציא תאריך/שעה/רופא שלא מופיעים ברשימה הזו.`
        } else {
          nextAvailableBlock = `\nלא נמצאה זמינות אמיתית לשירות המבוקש ב-${NEXT_AVAILABLE_SEARCH_DAYS} הימים הקרובים. הלקוח שאל על זמינות כללית — אל תמציא תאריך/שעה. אמור בעדינות שלא מצאת תור זמין (ראה הניסוח הקבוע בחוקים למטה) ושתעביר את הבקשה לנציג.`
        }
      }
    }

    // מסמך הנחיות שהועלה בהגדרות — הופך לבסיס הפרומפט של הבוט
    const agentInstructions = (business?.settings?.agent_instructions || '').trim()
    const instructionsBlock = agentInstructions
      ? `\n═══ מסמך הנחיות ותהליך העבודה של העסק — זהו מקור האמת המרכזי שלך. פעל לפיו בקפדנות: ═══\n${agentInstructions}\n═══ סוף מסמך ההנחיות ═══\n`
      : ''

    const systemPrompt = `אתה נציג של "${business?.name || 'העסק'}".
אתה מתכתב עם לקוחות בוואטסאפ בצורה חמה, אנושית ומקצועית.
אתה ישראלי, כותב עברית טבעית עם אימוג'ים מדי פעם.
${goalMap[business?.settings?.goal || 'appointment'] || ''}${greetingLine}${instructionsBlock}

- **המין הדקדוקי שלך, כשאתה מדבר על עצמך, הוא תמיד זכר** ("אני מבין", "אני שמח", "אני ממליץ", "רשמתי אותך") — בלי יוצא מן הכלל, ובלי קשר למגדר הפונה. זה נפרד לגמרי מהמגדר שבו אתה פונה ללקוח/ה (זה נקבע למטה) — קרה בפועל שהמין שלך "החליק" לנקבה (למשל "אני מבינה") רק כי פנית ללקוחה בלשון נקבה. אל תערבב בין השניים.

${genderInstructionBlock}

פרטי עסק:
${business?.settings?.description || ''}
כתובת: ${business?.address || ''} | אתר: ${business?.website || ''} | שעות פעילות: ${workingHoursText || 'לא הוגדרו'}
${servicesText ? `\nשירותים:\n${servicesText}` : ''}
${staffText}${closedDatesText}${existingApptText}${availableSlotsBlock}${nextAvailableBlock}
${qaText ? `\nQ&A:\n${qaText}` : ''}

חוקים:
- חוק ברזל: אסור לך להמציא שום מידע. כל עובדה שאתה אומר — מחיר, שעות פעילות, שם רופא/ה, סוג טיפול, מדיניות, זמינות — חייבת להתבסס אך ורק על המידע שסופק לך למעלה (פרטי עסק, שירותים, שיוך רופאים, שעות פעילות, מסמך הנחיות, Q&A). אם המידע לא מופיע שם — אתה לא יודע אותו, נקודה. אל תנחש, אל תשלים בהיגיון, ואל "תמלא חורים" בעצמך, גם אם התשובה נשמעת סבירה
- בנה אמון עם הלקוח — דבר איתו כמו בשיחה בין-אישית נעימה וחמה, לא כמו מכירה. תן לו מידע בנדיבות כשהוא שואל, אל תסתיר או תתחמק כדי "לדחוף" אותו לקבוע תור — לקוח שמרגיש שמקשיבים לו ונותנים לו תשובות אמיתיות סומך יותר ומגיע יותר
- ענה קצר וממוקד — בדרך כלל 2-3 משפטים. מותר להאריך במעט כשהשאלה דורשת פירוט אמיתי (למשל מדיניות ביטוח/תשלום, תהליך טיפול) — עדיף תשובה מלאה ומדויקת על תשובה קצרה שחסר בה מידע חשוב
- אל תזכיר שאתה AI או בוט
- אם אין לך מידע מספיק — אמור: "לפרטים נוספים אנא צרו איתנו קשר ישירות${business?.phone ? ` בטלפון ${business.phone}` : ''}${business?.website ? ` או באתר ${business.website}` : ''}" — אל תמציא מידע שלא קיים. ובסוף הוסף בשורה נפרדת: GAP:[השאלה שהלקוח שאל במדויק]
${agentInstructions
  ? `- פעל לפי זרימת השיחה שבמסמך ההנחיות: אסוף בהדרגה את הפרטים הנדרשים (שם מלא, סיבת הפנייה, העדפות) לפני אישור תור. שאלה אחת בכל הודעה — אל תמהר לסגור תור לפני שהשלמת את הבירור.`
  : `- אל תמהר לקבוע תור. גם כשהלקוח מביע עניין, קודם תבנה שיחה אמיתית — תשאל שאלה או שתיים על הצורך שלו, תקשיב ותגיב למה שהוא אומר, ורק אחרי שיש בסיס של היכרות ואמון תציע לקבוע תור. הצעה מיידית של "מתי נוח לך לבוא?" בלי לשמוע קודם מה מטריד אותו נשמעת מכנית, לא אנושית`}
${agentInstructions
  ? `- לפני אישור תור חובה שיהיו בידיך **כל** הפרטים שמסמך ההנחיות למעלה מבקש לאסוף — לא רק שם וסיבת פנייה, גם אם אלה היחידים שמופיעים בכללים הכלליים כאן. המסמך הוא הקובע. אם חסר פרט שהמסמך דורש — שאל עליו לפני שאתה סוגר תור. שאלה אחת בכל הודעה`
  : `- לפני אישור תור חובה שיהיו בידיך שני פרטים: (1) השם של הלקוח, (2) סיבת הפנייה (איזה טיפול/בעיה). אם חסר אחד מהם — שאל עליו לפני שאתה סוגר תור. שאלה אחת בכל הודעה`}
- כששואלים איך קוראים ללקוח — שאל בעדינות ובטבעיות, כמו בין אנשים: "איך קוראים לך?" או "עם מי יש לי הכבוד?" — לעולם אל תשאל "מה השם המלא שלך?" או "אנא מסור שם מלא", זה נשמע רשמי מדי ותוקפני. שם פרטי בלבד מספיק לגמרי — אל תבקש גם שם משפחה
- מותר וטבעי להזכיר את שם הרופא/ה המטפל/ת ביוזמתך — למשל כשמדברים על הטיפול המבוקש ("ד"ר X מתמחה בזה") או באישור תור. זה בונה אמון, לא סוד
- אם הלקוח מזכיר שם של רופא/ה — אשר את השם **רק** אם הוא מופיע ב"שיוך שירותים לרופאים" למעלה. אם השם לא ברשימה, אל תאשר ואל תבטיח "נעביר אותך אליו/אליה" — במקום זה אמור בעדינות שלא מזהים רופא/ה בשם הזה אצלכם, וכדאי לוודא שהוא/היא פנה/תה למרפאה הנכונה
- אם הלקוח מסר את שמו או את סיבת הפנייה בכל שלב — דווח אותם בתגית LEAD בסוף התשובה
- עברית תקינה בלבד: אמור "רושמים אותך" / "קבענו לך" — לעולם לא "נרשמים אותך". הקפד על ניסוח דקדוקי נכון בפנייה ללקוח
- אם הלקוח שואל על מחיר — תן מחיר אם קיים בשירותים, אל תתחמק
- אל תציע תורים בתאריכים הסגורים!
- הצע תורים רק בתוך שעות הפעילות של אותו יום בשבוע (ראה "שעות פעילות" למעלה) — אל תציע/תאשר שעה שהעסק סגור בה
- אל תאשר תור אחרי שכבר אישרת — אל תחזור להציע זמנים נוספים אחרי שקבעת
- אחרי שנקבע תור בשיחה — אסור להציע "לקבוע תור" שוב! הלקוח כבר קבע. בהמשך השיחה ענה על שאלות בלבד, ואם מתאים סיים ב"נשמח לראותך!" — לא בהצעה לקבוע
- אל תאמר "נראה לנו" — אמור "נשמח לראותך!" או "מחכים לך!" בלבד
- כאשר אתה מאשר תור — ציין תמיד את התאריך המלא בפורמט DD.MM.YYYY בהודעה (לדוגמה: "28.07.2026 בשעה 10:00")${business?.address ? `
- בהודעת אישור התור צרף תמיד גם את הכתובת: "${business.address}"` : ''}
- אם הלקוח מתאר סימפטום או בעיה שצילום/בדיקה קודמת (רנטגן, CT, תוצאות בדיקה) עשויים לעזור להבין — הצע לו ביוזמתך **את שתי האפשרויות יחד, לא רק אחת מהן**: גם לשלוח את זה כאן בצ'אט, וגם (במשפט אחד, לא שתי הודעות נפרדות) שאפשר להביא אותו איתו לפגישה אם קל יותר. רק כשזה רלוונטי לנושא שעלה בשיחה — לא לבקש את זה סתם
- אם אינך מוצא זמן/תור מתאים ללקוח (למשל כל השעות שהוא הציע מחוץ לשעות הפעילות, או שאין רופא/ה זמין/ה שמתאים לבקשה) — אל תמציא תור ואל תלחץ עליו לוותר. אמור: "לצערי לא מצאתי תור זמין 🙏 אני מעביר את הבקשה לנציג שיחזור אליך בהקדם." זו תשובה כנה, לא כישלון
- **לפני שאתה אומר "יש לנו תור פנוי ביום X בשעה Y" — ודא בעצמך מול "שיוך שירותים לרופאים" למעלה שהרופא/ה שמטפל/ת בטיפול המבוקש אכן עובד/ת ביום X (ראה "עובד/ת בימים" ליד שמו/ה).** אם אינך בטוח, או שהרופא/ה לא עובד/ת באותו יום — אל תציע את היום הזה בכלל, ואל תנחש שיש זמינות "כנראה". עדיף לומר את משפט "לא מצאתי תור זמין" למעלה מאשר להציע זמן שאתה לא בטוח לגביו — הבטחה שמתבטלת רגע אחרי שהיא ניתנת פוגעת יותר מתשובה כנה מההתחלה
- תמונות רפואיות (שיניים, צילום, CT, CBCT): אמור בלבד "תודה, שלחת צילום! הרופא יבדוק הכל בפגישה ויסביר לך 😊 רוצה לקבוע?" — אסור לתאר, לנתח או לפרש תמונות רפואיות!
- אם ההודעה מהלקוח היא "[מסמך]", "[סרטון]" או "[הודעה קולית]" (בלי טקסט נוסף) — זה סימון פנימי שקובץ כזה התקבל ונשמר בהצלחה אצלנו, לא הודעה שהלקוח כתב בעצמו. אל תגיד שאינך יכול לעזור או שיש בעיה — אמור בחום שקיבלת את הקובץ ושהרופא יעבור עליו בפגישה, בדיוק כמו בתמונה, ואל תתאר/תנתח את התוכן שלו
${business?.settings?.escalation_rule ? `- ${business.settings.escalation_rule} — אמור "אעביר אותך לנציג שלנו" וכתוב ESCALATE (ראה בסוף ההנחיות)` : ''}
- כל פעם שאתה אומר ללקוח משהו כמו "אעביר אותך לנציג"/"נציג יחזור אליך" (למשל: הלקוח מבקש נציג/אדם אמיתי במפורש, מבקש רופא שלא קיים ברשימה, חוזר על אותה שאלה בלי מענה מספק, מביע כעס/מצוקה) — זו לא רק הבטחה במילים, זה חייב להתלוות בתגית ESCALATE (ראה בסוף ההנחיות). בלי התגית הזו אף אחד לא באמת יקבל הודעה, אז אסור לשכוח אותה
- כשאתה אומר שאתה מעביר לנציג — **לעולם אל תבטיח זמן** ("מיד", "עכשיו", "תוך רגע", "בעוד כמה דקות" וכו'). תישאר כללי: "מעביר אותך לנציג שלנו" בלבד, בלי שום ציון זמן. הודעות מגיעות גם בלילה/מחוץ לשעות פעילות, ואי אפשר להבטיח שמישהו יראה את זה "מיד" — הבטחה כזו רק תאכזב את הלקוח

חשוב: בסוף כל תשובה הוסף בשורה נפרדת: LEAD:{"name":null,"reason":null,"temperature":"cold","status":"new"}
- name: השם המלא כפי שהלקוח מסר (למשל "משה כהן"). אם מסר רק שם פרטי — כתוב אותו. אם לא הציג עצמו — null
- reason: סיבת הפנייה במילים קצרות (למשל "טיפול שורש", "יישור שיניים", "כאב שן"). אם עדיין לא ידועה — null
- temperature: hot/medium/cold לפי רמת העניין
- status: new/contacted/in_progress/published (published רק אחרי אישור תור סופי)

לוח תאריכים — השתמש רק בתאריכים הבאים כשאתה מזכיר ימים:
${upcomingDatesText}

השעה עכשיו (שעון ישראל): ${String(israelNow.getUTCHours()).padStart(2, '0')}:${String(israelNow.getUTCMinutes()).padStart(2, '0')}
הערה: אם הלקוח אמר רק שם יום בלי "הבא" (למשל "ראשון 9:00") וזה חל על היום, אבל השעה כבר עברה — אין צורך שתטפל בזה בעצמך, המערכת מזהה את זה אוטומטית וקובעת לשבוע הבא באותו יום/שעה. פשוט כתוב APPT עם התאריך שהבנת מהלקוח כרגיל.

חובה! אם אישרת תור בתשובה זו — קביעת תור חדש **או הזזה/דחייה של תור קיים** (כלומר סיכמת זמן ותאריך עם הלקוח) — חייב להוסיף בשורה נפרדת בסוף:
APPT:{"date":"YYYY-MM-DD","time":"HH:MM","service":"שם השירות"}
- date: תאריך בפורמט YYYY-MM-DD בלבד — העתק ישירות מלוח התאריכים למעלה!
- time: שעה בפורמט HH:MM בלבד (שעון ישראל)
- service: אם רשימת "שירותים" מופיעה למעלה — **העתק בדיוק** את שם השירות המתאים ביותר מהרשימה הזו, אות באות כפי שהוא כתוב שם. אסור לנסח מחדש, לקצר, או להשתמש בתיאור אחר (כולל תיאורים שכתבת בעצמך קודם בשיחה, כמו תחום התמחות של רופא/ה) — גם אם זה נשמע מדויק יותר. חובה שם מזוהה מתוך הרשימה, לא ניסוח משלך. רק אם אין רשימת שירותים כלל, או שאף שירות ברשימה לא מתאים לבקשה — כתוב את מה שהלקוח בעצמו תיאר, במילותיו. אם למרות הכל לא ידועה הסיבה — כתוב null
בהזזת תור: כתוב את התאריך והשעה החדשים ב-APPT. אסור לאשר הזזה בלי APPT!
אם לא אישרת ולא הזזת תור — אל תכתוב APPT בכלל.

תזכורת לחזרה: אם הלקוח ביקש שנחזור אליו מאוחר יותר ("תחזור אלי", "דברו איתי בעוד יומיים",
"אני בפגישה", "תתקשרו אחר כך", "נדבר בשבוע הבא") — אשר לו בחום שנחזור אליו, והוסף בשורה נפרדת:
REMIND:{"date":"YYYY-MM-DD","time":"HH:MM"}
- קח את התאריך מלוח התאריכים למעלה. אם לא נקב בזמן מדויק — בחר מועד סביר (מחר ב-10:00)
- זו תזכורת לנציג לחזור ללקוח, לא תור! אל תכתוב APPT במקרה כזה
- אם הלקוח לא ביקש שנחזור אליו — אל תכתוב REMIND בכלל

העברה לנציג אנושי: בכל פעם שאמרת ללקוח שאתה מעביר אותו לנציג/אדם אמיתי (ולא תור/תזכורת רגילים) —
חובה להוסיף בשורה נפרדת בסוף:
ESCALATE:[סיבה קצרה — למשל "ביקש לדבר עם רופא שלא קיים", "ביקש נציג במפורש", "כעס ולא קיבל מענה"]
- זו הפעולה היחידה שבאמת מודיעה לצוות שנדרש מעקב אנושי — אתה ממשיך לענות ללקוח כרגיל בהודעות הבאות, זה רק דגל פנימי לצוות; אם לא תכתוב אותה, אף אחד לא יידע לחזור ללקוח
- אם לא הבטחת ללקוח שנציג יחזור אליו — אל תכתוב ESCALATE בכלל`

    // ─── קרא ל-OpenAI (GPT-4o-mini) ─────────────────────────────────────
    const groqHistory = history.slice(0, -1).map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.parts[0].text,
    }))
    const rawResponse = await geminiChat(systemPrompt, groqHistory, combinedText)

    if (!rawResponse) return NextResponse.json({ ok: true })

    const parsed = parseBotTags(rawResponse)
    const inlineAnalysis: LeadAnalysis | null = parsed.leadAnalysis
    let apptData = parsed.apptData
    const remindData = parsed.remindData

    // fallback: אם אין תגית ESCALATE אבל הבוט הבטיח בטקסט שנציג יחזור —
    // תופסים את זה מהניסוח (נבדק בפועל 17/08: המודל אמר את המשפט הנכון
    // אבל שכח את התגית — בלעדיה שום דבר לא נשמר והלקוח לא קיבל מעקב)
    let escalationReason = parsed.escalationReason
    if (!escalationReason) {
      escalationReason = extractEscalationFromText(parsed.cleanResponse)
      if (escalationReason) {
        console.log('[ai-respond] fallback escalation detected from text (missing tag):', JSON.stringify({ conversationId }))
      }
    }

    // fallback: אם אין תגית APPT אבל הבוט כתב אישור תור — חלץ מהטקסט (לוגיקה נבדקת בספרייה)
    if (!apptData) {
      const fallbackAppt = extractApptFromText(rawResponse)
      if (fallbackAppt) {
        // קרה בפועל: הלקוח שאל "למי?" (לא קשור לתאריך), והמודל "נזכר"
        // ובטעות שכפל אישור-תור ישן משיחה קודמת באותו thread — ה-fallback
        // הזה כמעט הזיז בשקט תור אמיתי שכבר קבוע ללקוח לתאריך שגוי. אם
        // ללקוח כבר יש תור עתידי אמיתי, והתאריך שחולץ שונה ממנו, ובהודעה
        // **הנוכחית** של הלקוח עצמו אין שום רמז לתאריך/שעה/אישור — זה
        // כנראה לא בקשה אמיתית לשינוי, מתעלמים מהחילוץ במקום להזיז תור
        const { data: leadRowForGuard } = await supabase.from('conversations').select('lead_id').eq('id', conversationId).maybeSingle()
        let existingFutureAppt: { scheduled_at: string } | null = null
        if (leadRowForGuard?.lead_id) {
          const { data } = await supabase.from('appointments')
            .select('scheduled_at')
            .eq('lead_id', leadRowForGuard.lead_id)
            .neq('status', 'cancelled')
            .gte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          existingFutureAppt = data || null
        }
        const fallbackDateDiffersFromExisting = existingFutureAppt
          && israelDateOnly(existingFutureAppt.scheduled_at) !== fallbackAppt.date
        if (fallbackDateDiffersFromExisting && !looksLikeSchedulingReply(combinedText)) {
          console.error('[ai-respond] IGNORED fallback appointment extraction — customer already has a future appointment and this turn shows no scheduling intent, likely the model echoed stale context:', JSON.stringify({
            conversationId, fallbackAppt, existingScheduledAt: existingFutureAppt?.scheduled_at, customerMessage: combinedText,
          }))
        } else {
          apptData = fallbackAppt
          console.log('[ai-respond] fallback appointment detected:', JSON.stringify(apptData))
        }
      } else if (/(\d{1,2}):(\d{2})/.test(rawResponse)) {
        console.error('[ai-respond] possible confirmation without parseable appointment — NOT saved:', rawResponse.slice(0, 200))
      }
    }

    // ─── תיקון דטרמיניסטי של תאריך יחסי ("מחר"/"מחרתיים"/"בעוד X ימים") ────
    // אם הלקוח (או הבוט עצמו קודם בשיחה) השתמשו במילת יחס מפורשת, התאריך
    // חייב להתאים לה בדיוק — בלי תלות בכך שהמודל יחשב נכון בעצמו. מונע
    // בדיוק את הבאג שבו GPT חישב תאריך שגוי כש"מחר בערב" נדחה (שעות סגורות)
    // וההודעה הבאה ("אז בצהריים") רק תיקנה שעה בלי לחזור על "מחר"
    if (apptData?.date) {
      const relOffset = resolveRelativeDayOffset(combinedText) ?? findRelativeDayOffsetInHistory(msgs)
      if (relOffset !== null) {
        const expectedISO = israelDateISOOffset(israelNow, relOffset)
        if (apptData.date !== expectedISO) {
          console.warn('[ai-respond] correcting appt date — model diverged from relative-day phrase in conversation:', JSON.stringify({ modelDate: apptData.date, expectedISO, relOffset }))
          apptData = { ...apptData, date: expectedISO }
        }
      }
    }

    // זיהוי פערי ידע — GAP:[שאלה]
    // כותבים ישירות למסד ולא דרך fetch לעצמנו: קריאה כזו תלויה ב-URL חיצוני
    // ובייצור היא נפלה בשקט על localhost — ולכן אף פער לא נרשם מעולם.
    if (parsed.gapQuestion) {
      await recordKnowledgeGap(businessId, parsed.gapQuestion, conversationId)
    }

    let aiResponse = parsed.cleanResponse

    if (!aiResponse) return NextResponse.json({ ok: true })

    // ─── דגל: יש זמינות אמיתית, אל תסלים בגללה ──────────────────────────
    // (יוסי, 01/09): כשמגיע SAFE_SLOT_RESPONSE, זה לא מספיק להחליף את
    // aiResponse — escalationReason כבר חושב **למעלה** (שורה ~587) מתוך
    // הטקסט **המקורי** של המודל (parsed.cleanResponse, לפני שהוחלף), ואם
    // המודל בטעות כתב "מעביר לנציג" (בדיוק המקרה בפועל: המודל ניסח בעצמו
    // "לא מצאתי תור... מעביר לנציג" למרות שהיו 4 slots אמיתיים) —
    // extractEscalationFromText תפס את זה כבר, ובלי הדגל הזה ה-escalation
    // עדיין היה נרשם ל-DB בסוף (למטה, ~שורה 846) גם אחרי שהתשובה שנשלחת
    // בפועל היא SAFE_SLOT_RESPONSE. לא נוגעים במנגנון ההסלמה עצמו — רק
    // מדלגים על ההפעלה שלו במקרה הספציפי הזה
    let suppressAvailabilityEscalation = false

    // ─── עיגון "שעות פנויות" מול הרשימה האמיתית שחושבה למעלה ──────────────
    // (יוסי, 01/09, INVARIANT אחרי מקרה פרודקשן אמיתי — service="הלבנה",
    // 4 slots אמיתיים נמצאו, ובכל זאת הלקוח קיבל "לא מצאתי תור זמין" +
    // הועבר לנציג): IF computedSlots.length > 0 → לעולם לא NO_AVAILABILITY,
    // לעולם לא הסלמה בגלל זמינות — רק SAFE_SLOT_RESPONSE, שנבנה ישירות
    // מהנתונים האמיתיים (buildSafeSlotResponse, botTags.ts), בלי תלות
    // בניסוח של ה-LLM בכלל. "כשל" עכשיו כולל גם "ה-LLM התעלם מהרשימה
    // וענה שאין זמינות" (mentionsAnyRealSlot=false), לא רק "המציא שעה" —
    // זה בדיוק מה שקרה בפועל. ה-IF/ELSE הזה שומר על ההתנהגות המקורית
    // במדויק כש-computedSlotsThisTurn.length===0 (allowedTimes ריק ⇒ כל
    // שעה מוזכרת נחשבת "לא מאושרת", בדיוק כמו קודם) — רק מוסיף ענף חדש
    // כש-length>0. רץ רק כשזו לא כבר פעולת קביעה אמיתית (apptData) — שם
    // יש כבר את שכבת האכיפה המלאה
    if (computedSlotsThisTurn !== null && !apptData) {
      const allowedTimes = new Set(computedSlotsThisTurn.map(sl => sl.time))
      const mentionedTimes = extractAllTimesInText(aiResponse)
      const hasInventedTime = mentionedTimes.some(t => !allowedTimes.has(t))
      const ignoredRealSlots = computedSlotsThisTurn.length > 0 && !mentionedTimes.some(t => allowedTimes.has(t))
      if (hasInventedTime || ignoredRealSlots) {
        if (computedSlotsThisTurn.length > 0) {
          console.error('[ai-respond] SAFE_SLOT_RESPONSE override — real slots exist but the model\'s response failed grounding (invented time / ignored the list / unparseable format) — never escalating when real availability exists:', JSON.stringify({
            conversationId, hasInventedTime, ignoredRealSlots, allowedTimes: Array.from(allowedTimes),
          }))
          aiResponse = buildSafeSlotResponse(computedSlotsThisTurn, profileMap)
          suppressAvailabilityEscalation = true
        } else {
          console.error('[ai-respond] RELIABILITY BLOCK — availability response mentioned a time not present in the real computed slots list:', JSON.stringify({
            conversationId, mentionedTimes,
          }))
          aiResponse = NO_AVAILABILITY_MESSAGE
          await supabase.from('conversations').update({
            escalated_at: new Date().toISOString(),
            escalation_reason: 'אין רופא/ה זמין/ה לטיפול המבוקש בתאריך/שעה שהתבקשו',
          }).eq('id', conversationId)
        }
      }
    }

    // ─── עיגון "התורים הקרובים ביותר" (GENERAL NEXT AVAILABLE) ────────────
    // אותו INVARIANT בדיוק כמו למעלה, מותאם לכך שכאן יש כמה תאריכים
    // אפשריים באותה תשובה — לא מספיק לבדוק ששעה "קיימת איפשהו ברשימה".
    // בודקים זוגות תאריך+שעה שלמים (extractAllDateTimePairsInText), שם
    // רופא/ה, ו**גם** אם התשובה מתעלמת מהרשימה לגמרי (בדיוק המקרה
    // בפועל: "לא מצאתי תור זמין" כשהיו 4 slots אמיתיים)
    if (computedNextAvailableSlots !== null && !apptData) {
      const allowedPairs = new Set(computedNextAvailableSlots.map(sl => `${sl.date}|${sl.time}`))
      const allowedDoctorNames = new Set(computedNextAvailableSlots.map(sl => profileMap[sl.doctorId]).filter(Boolean))
      const mentionedPairs = extractAllDateTimePairsInText(aiResponse)
      const hasInvalidPair = mentionedPairs.some(p => !allowedPairs.has(`${p.date}|${p.time}`))
      const allDoctorNames = Object.values(profileMap)
      const wrongDoctorMentioned = !!allDoctorNames.find(name => name && aiResponse.includes(name) && !allowedDoctorNames.has(name))
      const ignoredRealSlots = computedNextAvailableSlots.length > 0 && !mentionedPairs.some(p => allowedPairs.has(`${p.date}|${p.time}`))
      if (hasInvalidPair || wrongDoctorMentioned || ignoredRealSlots) {
        if (computedNextAvailableSlots.length > 0) {
          console.error('[ai-respond] SAFE_SLOT_RESPONSE override — real next-available slots exist but the model\'s response failed grounding (invented date/time, wrong doctor, ignored the list, or unparseable format) — never escalating when real availability exists:', JSON.stringify({
            conversationId, hasInvalidPair, wrongDoctorMentioned, ignoredRealSlots, allowedPairs: Array.from(allowedPairs),
          }))
          aiResponse = buildSafeSlotResponse(computedNextAvailableSlots, profileMap)
          suppressAvailabilityEscalation = true
        } else {
          console.error('[ai-respond] RELIABILITY BLOCK — general-availability response mentioned a date/time/doctor not present in the real computed next-available slots:', JSON.stringify({
            conversationId, hasInvalidPair, wrongDoctorMentioned,
          }))
          aiResponse = NO_AVAILABILITY_MESSAGE
          await supabase.from('conversations').update({
            escalated_at: new Date().toISOString(),
            escalation_reason: 'אין רופא/ה זמין/ה לטיפול המבוקש בתאריך/שעה שהתבקשו',
          }).eq('id', conversationId)
        }
      }
    }

    // ─── עיגון הצעת תור מול זמינות אמיתית — לפני שהיא בכלל נשלחת ────────────
    // קרה בפועל (24/08, אוריין): הבוט הציע "יש לנו תור פנוי ביום שני
    // הקרוב, 30.08.2026, בשעה 10:00" — הצעה תמימה, לא אישור (אין תגית
    // APPT בכלל בשלב הזה). הרופא היחיד המוסמך ל"סתימה" לא עובד בימי שני.
    // כשהלקוח ביקש לקבוע בפועל, הבדיקה האמיתית דחתה — "יש תור" ואז מיד
    // "אין תור", סתירה גמורה. רץ רק כשזו לא כבר פעולת קביעה אמיתית (יש
    // תגית APPT אמיתית/fallback) — שם יש כבר את שכבת האכיפה המלאה
    if (!apptData) {
      const offered = extractOfferedDateTime(aiResponse)
      if (offered) {
        // ─── resolver יחיד ל"מהו השירות" — לא ניחוש, לא lead.treatment_type ──
        // (יוסי, 31/08, מקרה ד"ר גבי סמל): קודם מה שהמודל כתב בתגית LEAD
        // בתור הנוכחי; אם חסר, סורק אחורה בהודעות **הנכנסות** של הלקוח
        // באותה שיחה (תופס גם "השתלה" → "יום שני?" → "כן", שבו התור
        // האחרון לא מזכיר את השירות בכלל אבל הוא עדיין ידוע מהקונטקסט)
        const { service: offerService, sinceIndex: offerServiceAnchorIndex } = resolveActiveServiceAnchor(inlineAnalysis?.reason, msgs, business?.settings?.services || [])

        // ─── FAIL-CLOSED, לא FAIL-OPEN, כשלא ידוע איזה שירות מבוקש ──────────
        // זה בדיוק מה שקרה בפועל עם ד"ר גבי סמל: כש-offerService יצא null,
        // hasQualifiedDoctorOnDate/findAvailableDoctorForExactSlot חוזרות
        // permissive (true/unknown) מעצם העיצוב שלהן, וההצעה הגולמית של
        // המודל (רופא+שעה, גם אם מומצאים) יצאה ללקוח בלי שום אימות. אם אחרי
        // ה-resolver למעלה עדיין אין service — לא קוראים לבדיקות האלה
        // בכלל (הן חסרות משמעות בלי service אמיתי) — פשוט חוסמים, כמו
        // "אין זמינות". שאר הלוגיקה (service קיים, אין שיוך רופאים בעסק
        // בכלל) ממשיכה בדיוק כמו קודם, לא נגעתי בזה
        let available = false
        let exactSlotBlocked = false
        if (!offerService) {
          console.error('[ai-respond] RELIABILITY BLOCK — cannot verify a doctor offer without a known service (fail-closed, not fail-open):', JSON.stringify({
            conversationId, offered,
          }))
        } else {
        available = hasQualifiedDoctorOnDate(
          offered.date, offerService,
          business?.settings?.employee_responsibilities || {},
          business?.settings?.employee_schedules || {},
          offered.time,
          business?.settings?.employee_min_lead_hours || {}
        )
        // ─── בדיקת תפוסה מדויקת בשעה, לא רק "עובד/ת ביום הזה" ───────────────
        // (יוסי, 31/08): hasQualifiedDoctorOnDate למעלה לא בודקת אם השעה
        // הספציפית כבר תפוסה. אם היא כן חשבה שיש זמינות (day-check עבר),
        // עוד בדיקה אמיתית מול היומן — אותה pickAvailableDoctor בדיוק
        // שמשמשת את הקביעה עצמה — לפני שההצעה בכלל נשלחת ללקוח
        if (available) {
          const matchedOfferSvc = (business?.settings?.services || []).find((sv: { name: string; duration?: string | number }) => offerService && sv.name?.includes(offerService))
          const offerDuration = matchedOfferSvc?.duration ? parseInt(String(matchedOfferSvc.duration)) : 60
          const slotCheck = await findAvailableDoctorForExactSlot(
            supabase, businessId,
            offered.date, offered.time, isNaN(offerDuration) ? 60 : offerDuration,
            offerService,
            business?.settings?.employee_responsibilities || {},
            business?.settings?.employee_schedules || {},
            business?.settings?.employee_min_lead_hours || {}
          )
          if (slotCheck.status === 'unavailable') {
            exactSlotBlocked = true
          } else if (slotCheck.status === 'available') {
            // (יוסי, 01/09, FIX 2, מקרה פרודקשן אמיתי): "מחר ב-14 יש מצב?"
            // — הבדיקה הזו אימתה status:'available' אצל ד"ר מסאוורה, ובכל
            // זאת ה-LLM ענה "לא מצאתי תור זמין" — סתירה גמורה לעובדה
            // שהקוד עצמו כבר אימת. לא מסתפקים יותר בתיקון-שם-בטקסט (fragile,
            // ולא תופס בכלל את המקרה של "אין" כשבאמת יש) — כשיש זמינות
            // אמיתית מאומתת, בונים תשובה דטרמיניסטית ישירות מהנתונים
            // (buildSafeExactSlotResponse), בלי תלות בניסוח ה-LLM בכלל.
            // עדיין שומרים על ההבחנה הקריטית (יוסי, 31/08): אם הלקוח
            // **בעצמו** ביקש רופא/ה ספציפי/ת בשם (בהודעה נכנסת משלו,
            // בהיקף הנושא הפעיל — extractCustomerRequestedDoctorId עם
            // sinceIndex), והרופא/ה הזמין/ה בפועל שונה — לא מחליפים בשקט,
            // שומרים על מסלול ההעברה לנציג הקיים
            const trueDoctorName = profileMap[slotCheck.doctorId] || null
            const allDoctorNames = Object.values(profileMap)
            const wrongName = allDoctorNames.find(name => name && aiResponse.includes(name) && name !== trueDoctorName)
            if (wrongName) {
              const customerRequestedDoctorId = extractCustomerRequestedDoctorId(msgs, profileMap, offerServiceAnchorIndex)
              if (customerRequestedDoctorId && customerRequestedDoctorId !== slotCheck.doctorId) {
                exactSlotBlocked = true
                console.error('[ai-respond] RELIABILITY BLOCK — customer explicitly requested a doctor who is not actually free at that exact time, not silently substituting:', JSON.stringify({
                  conversationId, offered, requestedDoctorId: customerRequestedDoctorId, trueDoctorName,
                }))
              }
            }
            if (!exactSlotBlocked) {
              aiResponse = buildSafeExactSlotResponse(offered.date, offered.time, trueDoctorName)
              // (יוסי, 01/09): כמו ב-SAFE_SLOT_RESPONSE — escalationReason
              // כבר חושב למעלה מתוך הטקסט **המקורי** של המודל (שיכול היה
              // לומר "מעביר לנציג" מתוך אותה סתירה שאנחנו מתקנים כרגע).
              // יש זמינות אמיתית מאומתת ⇒ שום הסלמה לא נובעת ממנה
              suppressAvailabilityEscalation = true
              console.log('[ai-respond] SAFE_EXACT_SLOT_RESPONSE — real availability verified by code for this exact date/time, response built deterministically (never trusting the model\'s own wording, whether it said yes with a wrong doctor or said no in contradiction to a real slot):', JSON.stringify({
                conversationId, offered, trueDoctorName,
              }))
            }
          }
        }
        }
        if (!available || exactSlotBlocked) {
          console.error('[ai-respond] RELIABILITY BLOCK — offered a date/time with no qualified doctor actually available, replacing with an honest answer:', JSON.stringify({
            conversationId, offered, offerService, exactSlotBlocked,
          }))
          // אותו נוסח בדיוק כמו no_doctor_available (קביעה בפועל) ואותה
          // התנהגות — מסומן "ממתין לנציג" לצוות, לא רק מילים ללקוח (יוסי, 24/08).
          // אין המצאת שעה חלופית — אותה הודעה קבועה + הסלמה, כמו תמיד
          aiResponse = NO_AVAILABILITY_MESSAGE
          await supabase.from('conversations').update({
            escalated_at: new Date().toISOString(),
            escalation_reason: 'אין רופא/ה זמין/ה לטיפול המבוקש בתאריך/שעה שהתבקשו',
          }).eq('id', conversationId)
        }
      }
    }

    // ─── צור ליד אם לא קיים (לפני שמירת תור) ────────────────────────────
    await ensureLeadExists(supabase, conversationId, businessId, senderPhone, messageText)

    // ─── אסקלציה לנציג אנושי — ESCALATE:[סיבה] ─────────────────────────────
    // בכוונה **לא** מכבים את הבוט (status נשאר 'active', bot_enabled לא
    // נוגע) — הבוט ממשיך לענות ללקוח כרגיל בהודעות הבאות, רק מסמן שדרושה
    // גם תשומת לב אנושית. ראה שיחה עם יוסי: "ממתין לנציג" הוא דגל מידע
    // לנציגה, לא מתג שמשתיק את הבוט — אחרת לקוח שממתין (כולל מי שביקש
    // נציג במפורש) עלול להישאר בלי שום מענה עד שמישהי שמה לב ומדליקה
    // אותו חזרה. ההודעה שהבוט שלח (עם ההבטחה שנציג יחזור) כבר נשמרת
    // כרגיל ב-messages, אז "אינטראקציה אחרונה" בטבלת הלידים תציג אותה
    // (יוסי, 01/09): לא מפעילים גם את זה כשהוחלט למעלה על SAFE_SLOT_RESPONSE
    // — escalationReason כאן עשוי לשקף רק את הטקסט **המקורי** של המודל
    // (למשל "מעביר לנציג" מתוך ניסוח שגוי שכבר הוחלף), לא את מה שבאמת
    // נשלח ללקוח. יש זמינות אמיתית ⇒ שום הסלמה לא נובעת ממנה
    if (escalationReason && !suppressAvailabilityEscalation) {
      await supabase.from('conversations').update({
        escalated_at: new Date().toISOString(),
        escalation_reason: escalationReason,
      }).eq('id', conversationId)
      console.log('[ai-respond] flagged for human rep (bot keeps answering):', JSON.stringify({ conversationId, reason: escalationReason }))
    }

    // ─── שמור/הזז תור לפני שליחת ההודעה — הצלחה נשלחת רק אחרי אימות ─────
    let apptResult: BotApptResult | null = null
    if (apptData?.date && apptData?.time) {
      const { data: convRow } = await supabase
        .from('conversations')
        .select('lead_id, contact_name')
        .eq('id', conversationId)
        .single()

      // סיבת הפנייה המזוהה מתגית LEAD (matchServiceReason מתחם אותה לרשימת
      // השירותים האמיתית) עשויה להיות ספציפית יותר מ-apptData.service הכללי
      // (למשל "השתלות" מול "אבחון") — עוברת כאיתות משני לשיוך הרופא, כדי
      // שלא ישויך רופא שלא מוסמך לטיפול שהלקוח באמת מבקש
      const secondaryService = matchServiceReason(inlineAnalysis?.reason, business?.settings?.services || [])

      // apptData.service הוא ניסוח חופשי של המודל (למשל "יישור שיניים") שלא
      // תמיד תואם מילולית לשם השירות הפורמלי שהעסק הגדיר ברשימה שלו (למשל
      // "אורתודנטיה") — קרה בפועל: אי-ההתאמה גרמה לכך שלא שויך רופא לתור
      // בכלל, וכתוצאה מזה גם שהתור לא סונכרן לאופטימה (חסר קוד רופא).
      // matchServiceReason מכיר גם כינויים נפוצים, לא רק הכלה מילולית
      const primaryService = matchServiceReason(apptData.service, business?.settings?.services || []) || apptData.service

      // קרה בפועל: הבוט הזכיר שם רופא/ה ספציפי/ת ללקוח בשיחה ("יש לנו תור
      // עם ד"ר X"), אבל שיוך הרופא בפועל (רוטציה כששני רופאים מוסמכים
      // לאותו שירות) בחר רופא/ה אחר/ת — האישור הסופי סתר את מה שכבר נאמר.
      // סורקים את היסטוריית ההודעות היוצאות לפני קביעת התור, כדי לכבד את
      // מה שכבר הובטח במקום להריץ רוטציה שלא מודעת לכך
      const preferredDoctorId = extractMentionedDoctorId(msgs, profileMap)

      apptResult = await saveOrRescheduleBotAppointment(supabase, {
        businessId,
        leadId: convRow?.lead_id || null,
        patientName: convRow?.contact_name || senderPhone,
        patientPhone: senderPhone,
        date: apptData.date,
        time: apptData.time,
        service: primaryService,
        secondaryService,
        services: business?.settings?.services || [],
        empResponsibilities: business?.settings?.employee_responsibilities || {},
        workingHours: s.working_hours_table,
        employeeSchedules: s.employee_schedules || {},
        employeeMinLeadHours: s.employee_min_lead_hours || {},
        businessExceptions: exceptions,
        preferredDoctorId,
      })

      if (!apptResult.ok) {
        console.error('[ai-respond] APPOINTMENT PERSIST FAILED', JSON.stringify({
          conversationId,
          leadId: convRow?.lead_id || null,
          requested: apptData,
          timezone: 'Asia/Jerusalem',
          result: apptResult,
        }))
        // מחוץ לשעות הפעילות / תאריך בעבר שגם קפיצת שבוע לא תיקנה — אלה לא
        // תקלות טכניות, אלא בקשות לא-תקינות של הלקוח. הודעה טבעית שמזמינה
        // שעה אחרת, לא הודעת "תקלה" מבלבלת שגם לא עוזרת ללקוח להמשיך
        aiResponse = buildApptErrorMessage(apptResult.error, workingHoursText)

        // no_doctor_available: ההודעה עצמה אומרת ללקוח "אני מעביר את הבקשה
        // לנציג" — אז זה חייב גם להופיע כ"ממתין לנציג" אצל הצוות, לא רק
        // כהודעה ללקוח. אותו מנגנון בדיוק כמו ESCALATE (בוט ממשיך לענות,
        // רק מסמן שדרושה גם תשומת לב אנושית)
        if (apptResult.error === 'no_doctor_available') {
          await supabase.from('conversations').update({
            escalated_at: new Date().toISOString(),
            escalation_reason: 'אין רופא/ה זמין/ה לטיפול המבוקש בתאריך/שעה שהתבקשו',
          }).eq('id', conversationId)
        }
      } else {
        console.log('[ai-respond] appointment verified:', JSON.stringify({
          action: apptResult.action, id: apptResult.id,
          oldTime: apptResult.oldTime, newTime: apptResult.newTime, verifiedAt: apptResult.verifiedAt,
          dateRolledForward: apptResult.dateRolledForward,
        }))

        // קרה בפועל פעמיים (יוסי, 19/08): apptData.service שהמודל כתב לא
        // תאם לשום שירות מוגדר (למשל כתב את תחום ההתמחות של הרופא במקום
        // את הטיפול שהלקוח ביקש) — התור נשמר בלי רופא, בלי אף התראה. אם
        // לעסק יש בכלל שיוך שירותים לרופאים, וזה בכל זאת קרה — משהו לא
        // תאם ושווה לבדוק, גם אם הקביעה עצמה לא נחסמת (לא רוצים לחסום
        // תור בגלל ניסוח, רק לדעת שזה קרה)
        if (!apptResult.assignedTo && Object.keys(business?.settings?.employee_responsibilities || {}).length > 0) {
          console.error('[ai-respond] RELIABILITY FLAG — appointment saved with no doctor even though the business has doctor↔service mapping configured (service text likely did not match any configured service):', JSON.stringify({
            conversationId, appointmentId: apptResult.id, rawService: apptData?.service, matchedService: primaryService,
          }))
        }

        // תור נקבע/הוזז בהצלחה — מנקים תזכורת "לחזור ללקוח" כללית שיכולה
        // להיות עדיין תלויה ועומדת (בפרט ברירת המחדל של +3 ימים שנקבעת
        // אוטומטית ברמת ה-DB ברגע שהליד נוצר, עוד לפני שהיה תור בכלל).
        // התור עצמו הוא הפעולה הבאה — תזכורת נפרדת רק מבלבלת מולו
        if (convRow?.lead_id) {
          await supabase.from('leads').update({ next_followup: null }).eq('id', convRow.lead_id)
        }

        // ─── סיכום תור מאומת — תמיד, בלי תלות בניסוח של המודל ─────────────
        // נבנה מהנתונים שנשמרו ואומתו בפועל ב-DB (apptResult), לא מהטקסט
        // שהמודל כתב — כך שגם אם המודל טעה בתאריך/שכח לציין אותו במפורש
        // (בדיוק הבאג שקרה בפועל), הלקוח עדיין מקבל בסוף כל אישור תור
        // סיכום מדויק: תאריך, שעה, רופא/ה (אם שויך), כתובת ומה כלול בבדיקה
        if (apptResult.newTime) {
          let doctorName: string | null = null
          if (apptResult.assignedTo) {
            const { data: doc } = await supabase
              .from('profiles').select('full_name').eq('id', apptResult.assignedTo).maybeSingle()
            doctorName = doc?.full_name || null
          }

          // ─── רשת ביטחון נוספת: בדיקת אמינות על כל השיחה, לא רק על ההודעה
          // הנוכחית ─────────────────────────────────────────────────────────
          // extractMentionedDoctorId (למעלה) כבר מונע את רוב המקרים מראש —
          // זו שכבה שנייה שרצה **אחרי** שהרופא נקבע סופית, וסורקת את כל
          // ההיסטוריה שהלקוח ראה (לא רק את מה שנשלח לו עכשיו) בשביל לתפוס
          // כל מקרה שבו שם רופא/ה אחר/ת בכל זאת הוזכר מול מי ששויך בפועל.
          // רק לוג — לא חוסם ולא משנה את ההודעה (הסיכום המאומת כבר תמיד נכון)
          if (Object.keys(profileMap).length > 0) {
            const allDoctorNames = Object.values(profileMap)
            const wrongDoctorInHistory = msgs.some(
              m => m.direction === 'outbound' && textMentionsWrongDoctor(m.content, doctorName, allDoctorNames)
            )
            if (wrongDoctorInHistory) {
              console.error('[ai-respond] RELIABILITY FLAG — a different doctor name was mentioned earlier in this conversation than the one actually assigned:', JSON.stringify({
                conversationId, assignedDoctorName: doctorName, appointmentId: apptResult.id,
              }))
            }
          }

          // אותה רשת ביטחון, לתאריכים: קרה בפועל עם רופאים (הבוט הבטיח שם
          // אחד, שויך אחר) — תאריך יכול להיסתר באותו אופן בדיוק בשיחה
          // חופשית לפני שהתור נקבע. הסיכום הסופי כבר תמיד נכון; זה רק לוג
          const correctDateISO = israelDateOnly(apptResult.newTime)
          const wrongDateInHistory = msgs.some(
            m => m.direction === 'outbound' && textStatesWrongDate(m.content, correctDateISO)
          )
          if (wrongDateInHistory) {
            console.error('[ai-respond] RELIABILITY FLAG — a different date was mentioned earlier in this conversation than the one actually saved:', JSON.stringify({
              conversationId, correctDateISO, appointmentId: apptResult.id,
            }))
          }

          const matchedSvc = (business?.settings?.services || [])
            .find((sv: { name: string; notes?: string }) => sv.name === primaryService)
          const summary = buildApptConfirmationSummary({
            newTimeISO: apptResult.newTime,
            doctorName,
            serviceName: apptData?.service || matchedSvc?.name || null,
            serviceNotes: matchedSvc?.notes || null,
            businessAddress: business?.address || null,
          })

          // תמיד מחליפים את כל ההודעה בסיכום המאומת — לא מוסיפים אותו אחרי
          // הניסוח החופשי של המודל. קרה בפועל: המודל כתב פסקת אישור משלו
          // (תאריך, כתובת, "מחכים לך") ואז הסיכום המאומת התווסף אחריה כהודעה
          // שנייה נפרדת — הלקוח קיבל שני בלוקים חוזרים על אותו מידע במקום
          // הודעה אחת קוהרנטית. הסיכום המאומת לבד, שנבנה מ-DB, הוא תמיד מדויק
          // ומספיק — אין צורך (וגם לא בטוח) לסמוך על שום חלק מניסוח המודל כאן
          aiResponse = summary

          // ─── שלב 1 של אינטגרציית אופטימה: שולחים את התור שנקבע גם ליומן
          // שלהם (כיוון אחד בלבד — מאיתנו אליהם). אין webhook הפוך מהצד שלהם,
          // אז שינויים שנעשים ישירות באופטימה לא יגיעו אלינו אוטומטית עדיין.
          // רץ אחרי שהתשובה נשלחת ללקוח (after) כדי לא לעכב את הבוט אם אופטימה
          // איטית/לא זמינה — כישלון כאן לא אמור לפגוע בחוויית הלקוח בוואטסאפ
          const optimaConfig = toOptimaConfig(business?.settings?.optima)
          const optimaDoctorCode = apptResult.assignedTo
            ? business?.settings?.optima_doctor_codes?.[apptResult.assignedTo]
            : null
          // קרה בפועל: תור נקבע בהצלחה ללקוח, אבל בלי רופא משויך (assignedTo
          // null) או בלי קוד אופטימה מוגדר לאותו רופא — הדחיפה לאופטימה
          // דולגה בשקט מוחלט, בלי שום שורת לוג. עדיף כישלון גלוי בלוגים על
          // שקט מסוכן, בדיוק כמו עקרון חיבור ה-Green API שכבר קיים כאן
          if (optimaConfig && !optimaDoctorCode) {
            console.error('[ai-respond] optima push SKIPPED — no doctor code:', JSON.stringify({
              conversationId, appointmentId: apptResult.id, assignedTo: apptResult.assignedTo,
            }))
          }
          if (optimaConfig && optimaDoctorCode) {
            const optimaParams = {
              doctorCode: optimaDoctorCode,
              appointmentDateISO: apptResult.newTime,
              durationMinutes: apptResult.durationMinutes || 30,
              subject: apptData?.service || undefined,
              cellPhone: senderPhone,
              firstName: convRow?.contact_name || undefined,
              remarks: 'נקבע אוטומטית על ידי הבוט (BetterLead)',
            }
            const apptId = apptResult.id
            after(async () => {
              // קרה בפועל: בלי card_id של מטופל קיים/חדש, אופטימה יוצרת
              // "בלוק זמן" ריק ביומן בלי שם/טלפון בכלל — לא תור אמיתי
              // שהצוות יכול לראות. מחפשים מטופל קיים לפי טלפון, ואם אין —
              // יוצרים כרטיס חדש. כישלון כאן לא חוסם את קביעת התור עצמה
              const cardId = await resolveOptimaCardId(optimaConfig, {
                phone972: senderPhone, firstName: convRow?.contact_name || undefined,
              })
              const r = await createOptimaAppointment(optimaConfig, { ...optimaParams, cardId: cardId || undefined })
              if (!r.ok) {
                console.error('[ai-respond] optima push failed:', JSON.stringify({ conversationId, error: r.error, status: r.status }))
              } else {
                console.log('[ai-respond] optima push ok:', conversationId)
                // שומרים את מזהה התור אצל אופטימה, כדי שרשת הביטחון היומית
                // (sync-optima) תזהה שהתור הזה כבר מוכר ולא תיצור כפילות
                if (r.optimaAppointmentId && apptId) {
                  await supabase.from('appointments').update({ optima_appointment_id: r.optimaAppointmentId }).eq('id', apptId)
                }
              }
            })
          }
        }
      }
    }

    // ─── עיגון תשובה חופשית שמזכירה רופא/ה בזהות אמיתית ────────────────────
    // קרה בפועל: לקוח קיים שאל "למי?" בהמשך שיחה אחרי קביעת תור (לא באותה
    // הודעה כמו הקביעה עצמה — הביקורת שכבר יש רצה רק בתור הקביעה), והבוט
    // ענה בשם רופא/ה שהוזכר/ה קודם בשיחה בלי לבדוק מול ה-DB — כשבפועל לא
    // שויך שום רופא לתור (assignedTo null). הבדיקה חלה **רק אם כבר קיים
    // תור** ללקוח (לא בוטל) — לפני שיש תור, מותר וטבעי לבוט להזכיר שם
    // רופא/ה ביוזמתו (למשל "יש לנו תור עם ד"ר X", המלצה כללית) בלי שזה
    // "יסתור" משהו, כי עדיין אין עובדה קיימת לסתור
    if (Object.keys(profileMap).length > 0) {
      const allDoctorNames = Object.values(profileMap)
      const mentionedDoctor = allDoctorNames.find(name => aiResponse.includes(name))
      if (mentionedDoctor) {
        // חיפוש לפי patient_phone, לא lead_id — אותו עיקרון כמו existingApptText
        // למעלה: תור שסונכרן מאופטימה יכול להיות בלי קישור ליד בכלל
        let existingAppt = false
        let trueDoctorName: string | null = null
        const { data: latestAppt } = await supabase.from('appointments')
          .select('assigned_to')
          .eq('business_id', businessId)
          .eq('patient_phone', senderPhone)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latestAppt) {
          existingAppt = true
          if (latestAppt.assigned_to) trueDoctorName = profileMap[latestAppt.assigned_to] || null
        }
        if (existingAppt && mentionedDoctor !== trueDoctorName) {
          console.error('[ai-respond] RELIABILITY BLOCK — response named a doctor not matching the actual assignment, replacing with a safe answer:', JSON.stringify({
            conversationId, mentionedDoctor, trueDoctorName,
          }))
          // התשובה הקודמת ("אחזור אליך") הבטיחה שהבוט עצמו יבדוק ויחזור —
          // בניגוד ישיר לעיקרון שנקבע במסמך ההנחיות: "הבוט לא בודק וחוזר,
          // הוא מעביר לנציג". תוקן לאותו ניסוח אחיד + סימון בפועל לצוות,
          // לא רק מילים ללקוח
          aiResponse = 'אני רוצה לוודא את הפרט הזה מול הצוות לפני שאני עונה — אני מעביר את זה לנציג שיחזור אליך עם תשובה מדויקת 😊'
          await supabase.from('conversations').update({
            escalated_at: new Date().toISOString(),
            escalation_reason: 'אי-התאמה בזיהוי הרופא/ה המשויך/ת לתור — נדרש אימות אנושי',
          }).eq('id', conversationId)
        }
      }
    }

    // ─── עיכוב אנושי (קוצר מ-2-5 שניות ל-0.8-1.5) ──────────────────────────
    await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 700)))

    // Load Green API credentials from DB (business-specific)
    // חובה שיגיעו מהחיבור של העסק הזה בפועל — אין fallback למשתני סביבה
    // גלובליים. עם יותר מלקוח אחד פעיל, fallback שקט כזה עלול לגרום
    // לשליחת הודעה מהמספר של עסק אחר. עדיף כישלון מפורש על שקט מסוכן.
    const { data: conn } = await supabase
      .from('whatsapp_connections')
      .select('api_token, api_url, instance_id')
      .eq('business_id', businessId)
      .eq('bot_enabled', true)
      .single()

    if (!conn?.api_url || !conn?.instance_id || !conn?.api_token) {
      console.error('[ai-respond] no active WhatsApp connection for business — refusing to send:', businessId)
      return NextResponse.json({ error: 'No active WhatsApp connection for this business' }, { status: 400 })
    }

    const greenInstance = cleanInstanceId(conn.instance_id)
    const chatId         = `${senderPhone}@c.us`

    // אינדיקטור הקלדה
    await fetch(
      buildGreenApiUrl(conn.api_url, greenInstance, 'showTyping', conn.api_token),
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, typeActivity: 'typing' }) }
    ).catch(() => {})

    // אינדיקטור הקלדה נשאר גלוי זמן קצר (קוצר מ-1-3 שניות ל-0.6-1.2)
    await new Promise(r => setTimeout(r, 600 + Math.floor(Math.random() * 600)))

    // ─── שלח הודעה ────────────────────────────────────────────────────────
    const sendRes = await fetch(
      buildGreenApiUrl(conn.api_url, greenInstance, 'sendMessage', conn.api_token),
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

    // ─── תזכורת ───────────────────────────────────────────────────────────
    // הבוט יצר קשר עם הלקוח → תזכורת בשלה יורדת.
    // אם באותה הודעה נקבעה תזכורת חדשה, היא תיכתב מיד אחרי הניקוי.
    await clearDueReminderByConversation(supabase, conversationId)

    if (remindData?.date && remindData?.time) {
      const normDate = normalizeApptDate(remindData.date)
      const when = normDate ? israelDateTime(normDate, remindData.time) : null
      const maxAhead = Date.now() + 400 * 86400000
      if (when && when.getTime() > Date.now() - 3600_000 && when.getTime() < maxAhead) {
        const { data: convRow2 } = await supabase
          .from('conversations').select('lead_id').eq('id', conversationId).single()
        if (convRow2?.lead_id) {
          const { error } = await supabase.from('leads')
            .update({ next_followup: when.toISOString() })
            .eq('id', convRow2.lead_id)
          if (error) console.error('[ai-respond] reminder save failed:', JSON.stringify(error))
          else console.log('[ai-respond] reminder set:', when.toISOString(), 'lead:', convRow2.lead_id)
        }
      } else {
        console.error('[ai-respond] reminder rejected — invalid/out-of-range date:', JSON.stringify(remindData))
      }
    }

    // ─── עדכן ליד ─────────────────────────────────────────────────────────
    if (apptResult?.ok) {
      // תור נשמר ואומת — אלץ סטטוס published
      const bookedAnalysis = {
        ...(inlineAnalysis || {}),
        status: 'published',
        temperature: 'hot',
        reason: inlineAnalysis?.reason || apptData?.service || null,
      }
      await updateLeadFromAnalysis(conversationId, senderPhone, bookedAnalysis, business?.settings?.services || [])
    } else if (inlineAnalysis) {
      // אם השמירה נכשלה — אסור לסמן published גם אם המודל חשב שנקבע תור
      if (apptData && inlineAnalysis.status === 'published') inlineAnalysis.status = 'in_progress'
      await updateLeadFromAnalysis(conversationId, senderPhone, inlineAnalysis, business?.settings?.services || [])
    }

    return NextResponse.json({ ok: true, appointment: apptResult || undefined })
  }
}


// ─── רישום פער ידע ישירות למסד ────────────────────────────────────────────────
async function recordKnowledgeGap(businessId: string, question: string, conversationId: string) {
  try {
    const clean = question.trim().slice(0, 500)
    if (!clean) return

    const { data: existing } = await supabase
      .from('knowledge_gaps')
      .select('id, asked_count')
      .eq('business_id', businessId)
      .ilike('question', clean)
      .eq('status', 'open')
      .maybeSingle()

    if (existing) {
      await supabase.from('knowledge_gaps').update({
        asked_count: (existing.asked_count || 0) + 1,
        last_asked_at: new Date().toISOString(),
      }).eq('id', existing.id)
      console.log('[ai-respond] knowledge gap count++:', clean)
    } else {
      const { error } = await supabase.from('knowledge_gaps').insert({
        business_id: businessId,
        question: clean,
        conversation_id: conversationId,
        status: 'open',
        asked_count: 1,
        last_asked_at: new Date().toISOString(),
      })
      if (error) console.error('[ai-respond] knowledge gap insert failed:', JSON.stringify(error))
      else console.log('[ai-respond] knowledge gap recorded:', clean)
    }
  } catch (e) {
    console.error('[ai-respond] recordKnowledgeGap error:', e)
  }
}

// ─── עדכון ליד מניתוח משולב (ללא קריאת Gemini נוספת) ────────────────────────
async function updateLeadFromAnalysis(
  conversationId: string,
  phone: string,
  analysis: { name?: string | null; reason?: string | null; temperature?: string; status?: string },
  services: { name: string }[] = []
) {
  try {
    analysis = { ...analysis, reason: matchServiceReason(analysis.reason, services) }
    const { data: conv } = await supabase
      .from('conversations')
      .select('lead_id')
      .eq('id', conversationId)
      .single()

    if (!conv?.lead_id) return

    const { data: lead } = await supabase
      .from('leads')
      .select('name, status, temperature, treatment_type, treatment_type_locked')
      .eq('id', conv.lead_id)
      .single()

    const updates = computeLeadUpdates(
      { name: lead?.name, status: lead?.status, treatment_type: lead?.treatment_type, treatment_type_locked: lead?.treatment_type_locked },
      analysis
    )

    if (Object.keys(updates).length > 0)
      await supabase.from('leads').update(updates).eq('id', conv.lead_id)

    if (updates.name)
      await supabase.from('conversations').update({ contact_name: updates.name }).eq('id', conversationId)

  } catch (e) {
    console.error('updateLeadFromAnalysis error:', e)
  }
}
