const fs = require('fs'), path = require('path'), env = {}
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

;(async () => {
  const { data: c } = await sb.from('whatsapp_connections')
    .select('instance_id, api_url, api_token')
    .eq('business_id', 'a71c354b-84e5-423d-861f-366dfc1b7b6d').single()
  const id = (c.instance_id || '').trim().replace(/^Instance\s+/i, '').trim()
  const base = `${c.api_url}/waInstance${id}`

  console.log('=== לפני הניקוי ===')
  const before = await (await fetch(`${base}/showMessagesQueue/${c.api_token}`)).json()
  console.log('  בתור:', Array.isArray(before) ? before.length : JSON.stringify(before))
  if (Array.isArray(before)) for (const m of before) console.log(`   → ${m.body?.chatId}: "${m.body?.message}"`)

  console.log('\n=== מנקה ===')
  const res = await fetch(`${base}/clearMessagesQueue/${c.api_token}`, { method: 'GET' })
  console.log('  HTTP', res.status, (await res.text()).trim())

  await new Promise(r => setTimeout(r, 2500))
  console.log('\n=== אחרי הניקוי ===')
  const after = await (await fetch(`${base}/showMessagesQueue/${c.api_token}`)).json()
  console.log('  בתור:', Array.isArray(after) ? after.length : JSON.stringify(after))

  const st = await (await fetch(`${base}/getStateInstance/${c.api_token}`)).json()
  console.log('  מצב החיבור:', st.stateInstance)
})()
