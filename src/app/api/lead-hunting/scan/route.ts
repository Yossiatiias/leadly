import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: 'קבוצות פייסבוק נסרקות על ידי leadly-scout — הלידים יופיעו אוטומטית לאחר הסריקה הבאה.',
  })
}
