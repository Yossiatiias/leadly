// בדיקות לניקוי תזכורות אחרי יצירת קשר
const fs = require('fs'), path = require('path'), env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const { clearDueReminder, clearDueReminderByConversation } =
  require(path.join(__dirname, '..', '.testbuild', 'leadReminders.js'))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BIZ = 'a71c354b-84e5-423d-861f-366dfc1b7b6d'

let pass = 0, fail = 0
const t = (n, c, x) => { if (c) { pass++; console.log('  PASS ', n) } else { fail++; console.log('  FAIL ', n, x !== undefined ? JSON.stringify(x) : '') } }
const getFollowup = async id => (await sb.from('leads').select('next_followup').eq('id', id).single()).data?.next_followup

;(async () => {
  const { data: lead } = await sb.from('leads').insert({
    business_id: BIZ, phone: '972500000097', name: 'בדיקת תזכורות',
    source: 'whatsapp', status: 'new', temperature: 'cold',
  }).select().single()

  console.log('── תזכורת בשלה (בעבר) ──')
  await sb.from('leads').update({ next_followup: new Date(Date.now() - 3600_000).toISOString() }).eq('id', lead.id)
  const r1 = await clearDueReminder(sb, lead.id)
  t('הוחזר true', r1 === true, r1)
  t('התזכורת נוקתה במסד', (await getFollowup(lead.id)) === null)

  console.log('── תזכורת עתידית לא נוגעים בה ──')
  const future = new Date(Date.now() + 5 * 86400000).toISOString()
  await sb.from('leads').update({ next_followup: future }).eq('id', lead.id)
  const r2 = await clearDueReminder(sb, lead.id)
  t('הוחזר false (לא נוקתה)', r2 === false, r2)
  const still = await getFollowup(lead.id)
  t('התזכורת נשארה במסד', still !== null && new Date(still).getTime() === new Date(future).getTime(), still)

  console.log('── בדיוק עכשיו נחשב בשל ──')
  await sb.from('leads').update({ next_followup: new Date(Date.now() - 1000).toISOString() }).eq('id', lead.id)
  t('נוקה', (await clearDueReminder(sb, lead.id)) === true)

  console.log('── ליד בלי תזכורת ──')
  t('לא קורס, מחזיר false', (await clearDueReminder(sb, lead.id)) === false)
  t('leadId ריק → false', (await clearDueReminder(sb, null)) === false)

  console.log('── דרך conversation_id ──')
  const { data: conv } = await sb.from('conversations').insert({
    business_id: BIZ, contact_phone: '972500000097', contact_name: 'בדיקת תזכורות',
    lead_id: lead.id, bot_enabled: false,
  }).select().single()
  await sb.from('leads').update({ next_followup: new Date(Date.now() - 7200_000).toISOString() }).eq('id', lead.id)
  t('נוקה דרך שיחה', (await clearDueReminderByConversation(sb, conv.id)) === true)
  t('אומת במסד', (await getFollowup(lead.id)) === null)
  t('שיחה לא קיימת → false', (await clearDueReminderByConversation(sb, '00000000-0000-0000-0000-000000000000')) === false)

  await sb.from('conversations').delete().eq('id', conv.id)
  await sb.from('leads').delete().eq('id', lead.id)
  console.log('── ניקוי הושלם ──')
  console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`)
  process.exit(fail ? 1 : 0)
})()
