export type LeadStatus = 'new' | 'contacted' | 'in_progress' | 'published' | 'not_relevant'
export type LeadSource = 'backoffice' | 'whatsapp' | 'social' | 'outreach' | 'manual'
export type LeadTemperature = 'hot' | 'medium' | 'cold'
export type ActivityType = 'call' | 'whatsapp' | 'note' | 'status_change'
export type UserRole = 'admin' | 'sales'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  created_at: string
}

export interface Lead {
  id: string
  created_at: string
  updated_at: string
  name: string
  phone: string | null
  email: string | null
  source: LeadSource
  status: LeadStatus
  temperature: LeadTemperature
  assigned_to: string | null
  notes: string | null
  campaign_name: string | null
  company_name: string | null
  clinic_count: number | null
  discount_percent: number | null
  next_followup: string | null
  last_contacted: string | null
  profile?: Profile
}

export interface LeadActivity {
  id: string
  created_at: string
  lead_id: string
  user_id: string
  type: ActivityType
  action: string
  details: string | null
  outcome: string | null
  profile?: Profile
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'חדש',
  contacted: 'ביצירת קשר',
  in_progress: 'בתהליך',
  published: 'פורסם',
  not_relevant: 'לא רלוונטי',
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  backoffice: 'בקאופיס',
  whatsapp: 'וואטסאפ',
  social: 'רשתות חברתיות',
  outreach: 'פנייה יזומה',
  manual: 'ידני',
}

export const TEMP_CONFIG = {
  hot:    { label: 'חם',    emoji: '🔴', bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500' },
  medium: { label: 'בינוני', emoji: '🟡', bg: 'bg-amber-50',  text: 'text-amber-600',  dot: 'bg-amber-400' },
  cold:   { label: 'קר',    emoji: '🔵', bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-600' },
}

export const STATUS_CONFIG: Record<LeadStatus, { label: string; bg: string; text: string }> = {
  new:          { label: 'חדש',          bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  contacted:    { label: 'ביצירת קשר',  bg: 'bg-amber-50',   text: 'text-amber-700' },
  in_progress:  { label: 'בתהליך',      bg: 'bg-teal-50',    text: 'text-teal-700' },
  published:    { label: 'פורסם',       bg: 'bg-green-50',   text: 'text-green-700' },
  not_relevant: { label: 'לא רלוונטי', bg: 'bg-gray-100',   text: 'text-gray-400' },
}

export function getPriorityScore(lead: Lead): number {
  let score = 0
  if (lead.temperature === 'hot') score += 100
  else if (lead.temperature === 'medium') score += 40
  else score += 5

  if (lead.next_followup) {
    const daysOverdue = Math.floor((Date.now() - new Date(lead.next_followup).getTime()) / 86400000)
    if (daysOverdue > 0) score += daysOverdue * 15
  }

  if (!lead.last_contacted) score += 30
  else {
    const daysSince = Math.floor((Date.now() - new Date(lead.last_contacted).getTime()) / 86400000)
    score += daysSince * 5
  }

  return score
}
