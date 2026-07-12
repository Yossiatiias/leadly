export type LeadStatus =
  | 'new' | 'contacted' | 'in_progress' | 'published' | 'not_relevant'
  | 'no_show' | 'arrived' | 'quote_sent' | 'quote_followup' | 'closed' | 'lost'

export type LeadSource =
  | 'backoffice' | 'whatsapp' | 'social' | 'outreach' | 'manual' | 'scrape' | 'bot'

export type LeadTemperature = 'hot' | 'medium' | 'cold'
export type ActivityType = 'call' | 'whatsapp' | 'note' | 'status_change'
export type UserRole = 'admin' | 'sales'

export type TreatmentType =
  | 'implant' | 'restorative' | 'veneers' | 'whitening'
  | 'orthodontics' | 'checkup' | 'other'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  business_id: string | null
  created_at: string
}

export interface Lead {
  id: string
  created_at: string
  updated_at: string
  name: string
  first_name: string | null
  last_name: string | null
  lead_number: number | null
  first_opened_at: string | null
  phone: string | null
  email: string | null
  source: LeadSource
  status: LeadStatus
  temperature: LeadTemperature
  treatment_type: TreatmentType | null
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

export interface LeadFile {
  id: string
  lead_id: string
  business_id: string
  file_name: string
  file_url: string
  file_size: number | null
  file_type: string | null
  uploaded_by: string | null
  created_at: string
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
  new:            'חדש',
  contacted:      'אין מענה',
  in_progress:    'למעקב',
  published:      'נקבע תור',
  not_relevant:   'לא רלוונטי',
  no_show:        'לא הגיע',
  arrived:        'הגיע',
  quote_sent:     'הצעת מחיר',
  quote_followup: 'מעקב אחר הצעה',
  closed:         'נסגר',
  lost:           'אבוד',
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  backoffice: 'בקאופיס',
  whatsapp:   'בוט וואטסאפ',
  social:     'רשתות חברתיות',
  outreach:   'פנייה יזומה',
  manual:     'הזנה ידנית',
  scrape:     'סריקה',
  bot:        'בוט',
}

export const TREATMENT_LABELS: Record<TreatmentType, string> = {
  implant:      'השתלות',
  restorative:  'טיפול משמר',
  veneers:      'ציפויים',
  whitening:    'הלבנה',
  orthodontics: 'יישור שיניים',
  checkup:      'בדיקה ואבחון',
  other:        'אחר',
}

export const TREATMENT_COLORS: Record<TreatmentType, string> = {
  implant:      '#6366F1',
  restorative:  '#10B981',
  veneers:      '#F59E0B',
  whitening:    '#3B82F6',
  orthodontics: '#EC4899',
  checkup:      '#14B8A6',
  other:        '#9CA3AF',
}

export const TEMP_CONFIG = {
  hot:    { label: 'חם',     emoji: '🔴', bg: 'bg-red-50',   text: 'text-red-700',   dot: 'bg-red-500' },
  medium: { label: 'בינוני', emoji: '🟡', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  cold:   { label: 'קר',     emoji: '🔵', bg: 'bg-sky-50',   text: 'text-sky-700',   dot: 'bg-sky-500' },
}

export const STATUS_CONFIG: Record<LeadStatus, { label: string; bg: string; text: string }> = {
  new:            { label: 'חדש',              bg: 'bg-sky-50',     text: 'text-sky-800' },
  contacted:      { label: 'אין מענה',         bg: 'bg-amber-50',   text: 'text-amber-800' },
  in_progress:    { label: 'למעקב',            bg: 'bg-lime-50',    text: 'text-lime-800' },
  published:      { label: 'נקבע תור',         bg: 'bg-green-50',   text: 'text-green-800' },
  not_relevant:   { label: 'לא רלוונטי',       bg: 'bg-slate-100',  text: 'text-slate-500' },
  no_show:        { label: 'לא הגיע',          bg: 'bg-purple-50',  text: 'text-purple-800' },
  arrived:        { label: 'הגיע',             bg: 'bg-blue-50',    text: 'text-blue-800' },
  quote_sent:     { label: 'הצעת מחיר',        bg: 'bg-cyan-50',    text: 'text-cyan-800' },
  quote_followup: { label: 'מעקב אחר הצעה',   bg: 'bg-indigo-50',  text: 'text-indigo-800' },
  closed:         { label: 'נסגר',             bg: 'bg-emerald-50', text: 'text-emerald-800' },
  lost:           { label: 'אבוד',             bg: 'bg-red-50',     text: 'text-red-800' },
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

export function isNewLead(lead: Lead): boolean {
  return lead.first_opened_at === null
}

export function getDisplayName(lead: Lead): string {
  if (lead.first_name) {
    return lead.last_name ? `${lead.first_name} ${lead.last_name}` : lead.first_name
  }
  return lead.name || ''
}

export function getLeadNumber(lead: Lead): string {
  return lead.lead_number ? String(lead.lead_number).padStart(5, '0') : '—'
}
