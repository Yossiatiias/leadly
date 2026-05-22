import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const SECRET = 'sesya2026'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, email, phone, secret, event, last_login } = body

    // Validate secret
    if (secret !== SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    }

    const supabase = await createClient()

    if (event === 'register') {
      // Check if lead already exists by email or phone
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .or(`email.eq.${email},phone.eq.${phone}`)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ message: 'Lead already exists', id: existing.id })
      }

      // Create new lead
      const { data, error } = await supabase.from('leads').insert({
        name,
        email: email || null,
        phone: phone || null,
        source: 'backoffice',
        status: 'new',
        temperature: 'cold',
        last_contacted: last_login || null,
      }).select().single()

      if (error) {
        console.error('Webhook insert error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ message: 'Lead created', id: data.id })
    }

    if (event === 'login') {
      // Update last_contacted for existing lead
      const query = email
        ? supabase.from('leads').update({ last_contacted: last_login || new Date().toISOString() }).eq('email', email)
        : supabase.from('leads').update({ last_contacted: last_login || new Date().toISOString() }).eq('phone', phone)

      await query

      return NextResponse.json({ message: 'Login recorded' })
    }

    return NextResponse.json({ error: 'Unknown event' }, { status: 400 })

  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
