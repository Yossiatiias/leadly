// בדיקת רגרסיה: בניית URL ל-Green API — הבאג של "Instance " לא יחזור
// הרצה: node scripts/test-green-api.js
const fs = require('fs')
const path = require('path')
const env = {}
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const { cleanInstanceId, greenApiUrl } = require(path.join(__dirname, '..', '.testbuild', 'greenApi.js'))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let passed = 0, failed = 0
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`) }
}

async function main() {
  console.log('── בדיקות יחידה: ניקוי instance_id ──')
  assert('"Instance 710722691468" → "710722691468"', cleanInstanceId('Instance 710722691468') === '710722691468')
  assert('"710722691468" נשאר כמו שהוא', cleanInstanceId('710722691468') === '710722691468')
  assert('"instance 123" (אותיות קטנות) מנוקה', cleanInstanceId('instance 123') === '123')
  assert('רווחים מיותרים נחתכים', cleanInstanceId('  Instance  456  ') === '456')
  assert('null → מחרוזת ריקה', cleanInstanceId(null) === '')

  console.log('── בדיקות יחידה: בניית URL ──')
  const u1 = greenApiUrl('https://7107.api.greenapi.com', 'Instance 710722691468', 'sendMessage', 'TOK')
  assert('URL תקין מקידומת', u1 === 'https://7107.api.greenapi.com/waInstance710722691468/sendMessage/TOK', u1)
  assert('אין "waInstanceInstance" ב-URL', !u1.includes('waInstanceInstance'), u1)
  assert('אין רווח ב-URL', !u1.includes(' '), u1)
  const u2 = greenApiUrl('https://7107.api.greenapi.com/', '710722691468', 'getStateInstance', 'TOK')
  assert('סלאש סופי ב-base נחתך', u2 === 'https://7107.api.greenapi.com/waInstance710722691468/getStateInstance/TOK', u2)
  const u3 = greenApiUrl(null, 'Instance 999', 'x', 'T')
  assert('ברירת מחדל ל-base כשחסר', u3.startsWith('https://7107.api.greenapi.com/waInstance999/'), u3)

  console.log('── בדיקת אינטגרציה מול Green API האמיתי ──')
  const { data: conns } = await sb.from('whatsapp_connections').select('business_id, instance_id, api_url, api_token')
  for (const c of conns || []) {
    const url = greenApiUrl(c.api_url, c.instance_id, 'getStateInstance', c.api_token)
    try {
      const r = await fetch(url)
      const body = await r.text()
      assert(`חיבור ${c.business_id.slice(0, 8)}: HTTP 200 (לא 404)`, r.status === 200, { status: r.status, body: body.slice(0, 120) })
      console.log(`        stateInstance: ${body.slice(0, 80)}`)
    } catch (e) {
      assert(`חיבור ${c.business_id.slice(0, 8)}: קריאה הצליחה`, false, e.message)
    }
  }

  console.log(`\nסה"כ: ${passed} עברו, ${failed} נכשלו`)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { console.error('RUNNER ERROR:', e); process.exit(1) })
