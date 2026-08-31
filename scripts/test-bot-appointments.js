// בדיקות למנגנון שמירת/הזזת תורים של הבוט
// הרצה: node scripts/test-bot-appointments.js   (מתוך שורש הפרויקט, אחרי קומפילציה)
const fs = require('fs')
const path = require('path')

// ─── env ───
const env = {}
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { createClient } = require('@supabase/supabase-js')
const lib = require(path.join(__dirname, '..', '.testbuild', 'botAppointments.js'))
const { normalizeApptDate, israelDateTime, saveOrRescheduleBotAppointment, extractApptFromText } = lib

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BUSINESS_ID = 'a71c354b-84e5-423d-861f-366dfc1b7b6d' // שקד קליניק
const TEST_PHONE = '972500000099'

let passed = 0, failed = 0
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`) }
}

async function main() {
  console.log('── בדיקות יחידה: פירוש תאריכים ──')
  assert('03.08.2026 → 2026-08-03 (אוגוסט, לא מרץ)', normalizeApptDate('03.08.2026') === '2026-08-03', normalizeApptDate('03.08.2026'))
  assert('3/8/2026 → 2026-08-03', normalizeApptDate('3/8/2026') === '2026-08-03')
  assert('2026-08-03 עובר כמו שהוא', normalizeApptDate('2026-08-03') === '2026-08-03')
  assert('זבל → null', normalizeApptDate('מחר בבוקר') === null)

  console.log('── בדיקות יחידה: Asia/Jerusalem ──')
  const summer = israelDateTime('2026-08-03', '09:00')
  assert('קיץ (IDT +03): 03.08 09:00 → 06:00 UTC', summer && summer.toISOString() === '2026-08-03T06:00:00.000Z', summer && summer.toISOString())
  const winter = israelDateTime('2026-01-15', '09:00')
  assert('חורף (IST +02): 15.01 09:00 → 07:00 UTC', winter && winter.toISOString() === '2026-01-15T07:00:00.000Z', winter && winter.toISOString())

  console.log('── בדיקות יחידה: תאריך לא-קיים לא מתגלגל ──')
  assert('31.02.2026 נדחה (לא מתגלגל למרץ)', israelDateTime('2026-02-31', '09:00') === null, israelDateTime('2026-02-31', '09:00'))
  assert('31.04.2026 נדחה (אפריל = 30 ימים)', israelDateTime('2026-04-31', '10:00') === null)
  assert('29.02.2028 תקין (שנה מעוברת)', israelDateTime('2028-02-29', '09:00') !== null)

  console.log('── בדיקות יחידה: חילוץ תור מטקסט (fallback) ──')
  const ex1 = extractApptFromText('מצוין! קבענו לך תור לאבחון ביום שני, 10.08.2026 בשעה 11:00. מחכים לך!')
  assert('אישור רגיל: תאריך ושעה נקלטים', ex1 && ex1.date === '2026-08-10' && ex1.time === '11:00', ex1)
  const ex2 = extractApptFromText('התור שלך הוזז מ-03.08.2026 בשעה 09:00 ל-10.08.2026 בשעה 11:00. נשמח לראותך!')
  assert('הודעת הזזה עם 2 תאריכים: נלקח האחרון (החדש!)', ex2 && ex2.date === '2026-08-10' && ex2.time === '11:00', ex2)
  const ex3 = extractApptFromText('קבענו לך תור מחר בשעה 09:30. מחכים לך!')
  assert('"מחר" בלי תאריך מפורש: תאריך מחר', ex3 && ex3.time === '09:30' && ex3.date === new Date(Date.now() + 3 * 3600000 + 86400000).toISOString().slice(0, 10), ex3)
  const ex4 = extractApptFromText('קבענו לך תור בשעה 14:00 ליום ראשון הקרוב!')
  assert('אישור בלי תאריך ובלי מחר/היום: null (לא מנחשים)', ex4 === null, ex4)
  const ex5 = extractApptFromText('שעות הפעילות שלנו הן 09:00 עד 18:00')
  assert('טקסט בלי מילת אישור: null', ex5 === null, ex5)

  console.log('── בדיקות אינטגרציה (Supabase אמיתי) ──')
  // ליד בדיקה נקי
  await sb.from('appointments').delete().eq('patient_phone', TEST_PHONE)
  const { data: testLead } = await sb.from('leads').insert({
    business_id: BUSINESS_ID, phone: TEST_PHONE, name: 'בדיקה אוטומטית', source: 'whatsapp', status: 'new', temperature: 'cold',
  }).select().single()

  const base = {
    businessId: BUSINESS_ID, leadId: testLead.id,
    patientName: 'בדיקה אוטומטית', patientPhone: TEST_PHONE,
    services: [], empResponsibilities: {},
  }

  // 1. יצירת תור חדש 03.08.2026 09:00
  const r1 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '03.08.2026', time: '09:00', service: 'אבחון' })
  assert('יצירה: ok', r1.ok === true, r1)
  assert('יצירה: action=created', r1.action === 'created', r1.action)
  assert('יצירה: read-back = 2026-08-03T06:00:00.000Z', r1.verifiedAt === '2026-08-03T06:00:00.000Z', r1.verifiedAt)

  // 2. ניסיון חוזר זהה — לא נוצר כפול
  const r2 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '2026-08-03', time: '09:00', service: 'אבחון' })
  assert('ניסיון חוזר: ok + unchanged', r2.ok === true && r2.action === 'unchanged', r2)
  assert('ניסיון חוזר: אותו id', r2.id === r1.id)
  const { count: c1 } = await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('lead_id', testLead.id)
  assert('ניסיון חוזר: עדיין תור אחד בלבד', c1 === 1, c1)

  // 3. הזזה ל-04.08.2026 10:00 — עדכון אותה שורה, לא שורה חדשה
  const r3 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '04.08.2026', time: '10:00', service: null })
  assert('הזזה: ok + rescheduled', r3.ok === true && r3.action === 'rescheduled', r3)
  assert('הזזה: אותו id (עדכון, לא יצירה)', r3.id === r1.id)
  assert('הזזה: oldTime = הזמן הקודם', r3.oldTime === '2026-08-03T06:00:00.000Z', r3.oldTime)
  assert('הזזה: read-back = 2026-08-04T07:00:00.000Z', r3.verifiedAt === '2026-08-04T07:00:00.000Z', r3.verifiedAt)
  const { count: c2 } = await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('lead_id', testLead.id)
  assert('הזזה: עדיין תור אחד בלבד', c2 === 1, c2)

  // 4. כשל API לא מוחזר כהצלחה — client עם מפתח שגוי
  const badSb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, 'eyJbroken.invalid.key')
  const r4 = await saveOrRescheduleBotAppointment(badSb, { ...base, leadId: null, date: '05.08.2026', time: '11:00', service: null })
  assert('כשל API: ok=false (לא הצלחה שקרית)', r4.ok === false, r4)

  // 5. read-back מחזיר זמן שונה → כישלון מפורש
  const mismatchSb = {
    from(table) {
      const chain = {
        _op: null,
        select() { return chain }, eq() { return chain }, gte() { return chain }, in() { return chain },
        order() { return chain }, limit() { return chain },
        update() { chain._op = 'update'; return chain },
        insert() { chain._op = 'insert'; return chain },
        single() { return Promise.resolve({ data: { id: 'fake-id' }, error: null }) },
        maybeSingle() {
          // חיפוש תור קיים → מחזיר תור; read-back → מחזיר זמן שגוי בכוונה
          if (chain._op === null && chain._selectedReadback) {
            return Promise.resolve({ data: { id: 'fake-id', scheduled_at: '2026-08-09T09:09:00.000Z', status: 'scheduled' }, error: null })
          }
          chain._selectedReadback = true
          return Promise.resolve({ data: { id: 'fake-id', scheduled_at: '2026-08-01T06:00:00.000Z' }, error: null })
        },
        then(res) { return Promise.resolve({ data: null, error: null }).then(res) }, // update await
      }
      return chain
    },
  }
  const r5 = await saveOrRescheduleBotAppointment(mismatchSb, { ...base, date: '06.08.2026', time: '09:00', service: null })
  assert('read-back שונה מהמבוקש: ok=false + readback_mismatch', r5.ok === false && r5.error === 'readback_mismatch', r5)

  // 6. תור לא נמצא בהזזה (נמחק באמצע) → נוצר חדש במקום קריסה
  await sb.from('appointments').delete().eq('lead_id', testLead.id)
  const r6 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '05.08.2026', time: '12:00', service: null })
  assert('תור נמחק: נוצר חדש (created)', r6.ok === true && r6.action === 'created', r6)

  // 7. תאריך בעבר (היום בשעה שעברה) → כישלון מפורש, לא קידום שנה
  const todayISR = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)
  const r7 = await saveOrRescheduleBotAppointment(sb, { ...base, date: todayISR, time: '00:01', service: null })
  assert('תאריך שעבר: ok=false + date_in_past (לא 2027!)', r7.ok === false && r7.error === 'date_in_past', r7)

  // 8. שנה ישנה מהמודל (2024) עם תאריך עתידי → מתוקן לשנה הנוכחית בלבד
  const r8 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '29.12.2024', time: '09:00', service: null })
  assert('שנה ישנה: תוקן ל-2026 (לא נכשל, לא 2027)', r8.ok === true && r8.newTime?.startsWith('2026-12-29'), r8)

  // 9. תאריך רחוק מדי (הזיה כמו 2030) → כישלון מפורש
  const r9 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '10.08.2030', time: '09:00', service: null })
  assert('2030: ok=false + date_too_far', r9.ok === false && r9.error === 'date_too_far', r9)

  // 10. תאריך לא-קיים (31.02) → כישלון מפורש, לא גלגול למרץ
  const r10 = await saveOrRescheduleBotAppointment(sb, { ...base, date: '31.02.2027', time: '09:00', service: null })
  assert('31.02: ok=false (לא הפך ל-3 במרץ)', r10.ok === false, r10)

  // ─── ניקוי ───
  await sb.from('appointments').delete().eq('lead_id', testLead.id)
  await sb.from('leads').delete().eq('id', testLead.id)
  console.log('── ניקוי נתוני בדיקה הושלם ──')

  console.log(`\nסה"כ: ${passed} עברו, ${failed} נכשלו`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(1) })
