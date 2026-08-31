import fs from 'fs'
const env = {}
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^=]+)=(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim()
})
const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// find a conversation to test with (harmless: just updating last_opened_at, read-only otherwise)
const { data: convs } = await supabase.from('conversations').select('id, updated_at, last_opened_at').limit(1)
const conv = convs[0]
console.log('BEFORE:', JSON.stringify(conv))

const openedAt = new Date().toISOString()
await supabase.from('conversations').update({ last_opened_at: openedAt }).eq('id', conv.id)

const { data: after } = await supabase.from('conversations').select('id, updated_at, last_opened_at').eq('id', conv.id).single()
console.log('AFTER:', JSON.stringify(after))
console.log('client openedAt was:', openedAt)
console.log('updated_at > last_opened_at?', new Date(after.updated_at) > new Date(after.last_opened_at))
