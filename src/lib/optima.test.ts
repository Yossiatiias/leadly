import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatOptimaDateTime, buildCreateAppointmentQuery, createOptimaAppointment,
  normalizeOptimaPhone, parseOptimaDateTime, computeDurationMinutes, fetchOptimaAppointments, toOptimaConfig,
  searchOptimaPatient, createOptimaContact, toOptimaLocalPhone, resolveOptimaCardId,
  type OptimaConfig,
} from './optima'

const CONFIG: OptimaConfig = {
  baseUrl: 'https://calendar.hatosafim.co.il/api2',
  username: 'shakedmed88',
  password: 'secret',
  company: '1',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatOptimaDateTime — Israel-local DD/MM/YYYY + HH:MM:SS, not raw UTC', () => {
  it('converts a UTC instant to Israel summer time (+3)', () => {
    // 09:00 UTC in August = 12:00 Israel (DST)
    const { date, time } = formatOptimaDateTime('2026-08-09T09:00:00.000Z')
    expect(date).toBe('09/08/2026')
    expect(time).toBe('12:00:00')
  })
})

describe('buildCreateAppointmentQuery', () => {
  it('includes all required fields with the correct format', () => {
    const qs = buildCreateAppointmentQuery(CONFIG, {
      doctorCode: '6',
      appointmentDateISO: '2026-08-09T09:00:00.000Z',
      durationMinutes: 30,
      subject: 'בדיקה',
      cellPhone: '972500000000',
      firstName: 'דנה',
      lastName: 'כהן',
    })
    expect(qs.get('company')).toBe('1')
    expect(qs.get('doctor_code')).toBe('6')
    expect(qs.get('site_code')).toBe('1') // ברירת מחדל
    expect(qs.get('appointment_date')).toBe('09/08/2026')
    expect(qs.get('appointment_start_time')).toBe('12:00:00')
    expect(qs.get('duration_minutes')).toBe('30')
    expect(qs.get('subject')).toBe('בדיקה')
    expect(qs.get('cell_phone')).toBe('972500000000')
  })

  it('respects an explicit site_code override', () => {
    const qs = buildCreateAppointmentQuery(CONFIG, {
      doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30, siteCode: '2',
    })
    expect(qs.get('site_code')).toBe('2')
  })

  it('omits optional fields cleanly when not provided', () => {
    const qs = buildCreateAppointmentQuery(CONFIG, {
      doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30,
    })
    expect(qs.has('subject')).toBe(false)
    expect(qs.has('cell_phone')).toBe(false)
    expect(qs.has('card_id')).toBe(false)
  })

  // קרה בפועל: בלי card_id אופטימה יוצרת בלוק זמן ריק ביומן בלי שם/טלפון
  // בכלל (AppointmentType=2), לא תור אמיתי עם המטופל מקושר
  it('includes card_id when a resolved patient card is passed', () => {
    const qs = buildCreateAppointmentQuery(CONFIG, {
      doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30, cardId: '11278',
    })
    expect(qs.get('card_id')).toBe('11278')
  })
})

describe('createOptimaAppointment — real behavior against a fake network', () => {
  it('sends HTTP Basic Auth built from the given credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({
      ok: true, json: async () => ({ result_status: '0', new_card_id: '0' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/create_appointment?')
    expect(url).toContain('company=1')
    const expectedAuth = 'Basic ' + Buffer.from('shakedmed88:secret').toString('base64')
    expect(opts?.headers).toMatchObject({ Authorization: expectedAuth })
  })

  it('returns ok:true when result_status is "0"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result_status: '0' }) })))
    const r = await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })
    expect(r.ok).toBe(true)
  })

  it('returns ok:false when Optima reports a non-zero result_status even on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result_status: '1', error: 'card_not_found' }) })))
    const r = await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('result_status')
  })

  it('returns ok:false on HTTP error status (e.g. the 504 we saw in practice for an inactive company)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504, json: async () => ({ detail: 'Timeout waiting for WS response' }) })))
    const r = await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(504)
  })

  it('returns ok:false instead of throwing when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const r = await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('network down')
  })

  it('captures the AppointmentID from the response when Optima returns one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result_status: '0', AppointmentID: 12345 }) })))
    const r = await createOptimaAppointment(CONFIG, { doctorCode: '6', appointmentDateISO: '2026-08-09T09:00:00.000Z', durationMinutes: 30 })
    expect(r.optimaAppointmentId).toBe('12345')
  })
})

describe('toOptimaConfig — converts businesses.settings.optima (snake_case, as stored in DB) to OptimaConfig', () => {
  it('maps snake_case fields to the camelCase shape the rest of the lib expects', () => {
    const cfg = toOptimaConfig({ base_url: 'https://x.example.com/api2', username: 'u', password: 'p', company: '1' })
    expect(cfg).toEqual({ baseUrl: 'https://x.example.com/api2', username: 'u', password: 'p', company: '1' })
  })

  it('returns null when any required field is missing (never builds a partial config)', () => {
    expect(toOptimaConfig({ base_url: 'https://x.example.com/api2', username: 'u' })).toBeNull()
    expect(toOptimaConfig(null)).toBeNull()
    expect(toOptimaConfig(undefined)).toBeNull()
  })
})

describe('normalizeOptimaPhone — matches the 972XXXXXXXXX format we store our own leads under', () => {
  it('converts a local 0-prefixed number', () => {
    expect(normalizeOptimaPhone('0535259926')).toBe('972535259926')
  })

  it('keeps an already-international number as-is', () => {
    expect(normalizeOptimaPhone('972525608739')).toBe('972525608739')
  })

  it('cleans a "dirty" phone with trailing letters (real case seen in Optima data)', () => {
    expect(normalizeOptimaPhone('0549436570אריק')).toBe('972549436570')
  })

  it('returns null for an empty/missing phone', () => {
    expect(normalizeOptimaPhone('')).toBeNull()
    expect(normalizeOptimaPhone(null)).toBeNull()
  })
})

describe('parseOptimaDateTime — Israel-local Optima fields to a correct UTC instant', () => {
  it('parses a summer (DST, +3) date/time correctly', () => {
    // 09/08/2026 14:45 Israel summer time = 11:45 UTC
    const iso = parseOptimaDateTime('09/08/2026 00:00:00', '14:45:00')
    expect(iso).toBe('2026-08-09T11:45:00.000Z')
  })

  it('returns null for malformed input instead of a wrong silent date', () => {
    expect(parseOptimaDateTime('not-a-date', '14:45:00')).toBeNull()
  })
})

describe('computeDurationMinutes', () => {
  it('computes the gap between start and end', () => {
    expect(computeDurationMinutes('14:45:00', '14:55:00')).toBe(10)
  })

  it('falls back to 30 minutes for zero/negative or malformed ranges', () => {
    expect(computeDurationMinutes('14:45:00', '14:45:00')).toBe(30)
    expect(computeDurationMinutes('bad', '14:45:00')).toBe(30)
  })
})

describe('toOptimaLocalPhone — converts our 972XXXXXXXXX format to the local 0XXXXXXXXX format Optima searches by', () => {
  it('replaces the 972 prefix with a leading 0', () => {
    expect(toOptimaLocalPhone('972503952745')).toBe('0503952745')
  })
  it('passes through a number that is already local', () => {
    expect(toOptimaLocalPhone('0503952745')).toBe('0503952745')
  })
})

describe('searchOptimaPatient — real response shape verified against the live API', () => {
  it('flattens the patients object (keyed by card id) into an array, collecting all phone fields', async () => {
    // תצורת תשובה אמיתית שנבדקה מול ה-API החי: patients הוא אובייקט,
    // לא מערך, והטלפון בפועל יכול להיות בכל אחד מכמה שדות (כאן ExPhone
    // מאוכלס בעוד CellPhone/HomePhone/WorkPhone ריקים)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        patients: {
          '11278': {
            CardId: 11278, FirstName: 'חיים אליה', LastName: 'טויג', FullName: 'טויג חיים אליה',
            CellPhone: '', HomePhone: '', WorkPhone: '', ExPhone: '053580000', ExPhone2: '',
          },
        },
      }),
    })))
    const r = await searchOptimaPatient(CONFIG, '053580000')
    expect(r).toEqual([{ cardId: '11278', fullName: 'טויג חיים אליה', phones: ['053580000'] }])
  })

  it('returns an empty array when no patient matches (real shape: patients: {})', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ patients: {} }) })))
    expect(await searchOptimaPatient(CONFIG, 'לא קיים')).toEqual([])
  })

  it('returns an empty array instead of throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await searchOptimaPatient(CONFIG, '0500000000')).toEqual([])
  })
})

describe('createOptimaContact', () => {
  it('returns the new card id on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ CardID: '99001' }) })))
    const r = await createOptimaContact(CONFIG, { firstName: 'דנה', cellPhone: '0500000000' })
    expect(r).toEqual({ ok: true, cardId: '99001' })
  })

  it('returns ok:false when the response has no usable card id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    const r = await createOptimaContact(CONFIG, { firstName: 'דנה' })
    expect(r.ok).toBe(false)
  })
})

describe('resolveOptimaCardId — finds an existing patient by phone, else creates a new contact', () => {
  it('returns the existing card id when a patient with a matching phone is found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ patients: { '11278': { CardId: 11278, ExPhone: '0503952745' } } }),
    })))
    const cardId = await resolveOptimaCardId(CONFIG, { phone972: '972503952745' })
    expect(cardId).toBe('11278')
  })

  it('creates a new contact when no matching patient is found', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/search_patient')) return { ok: true, json: async () => ({ patients: {} }) }
      return { ok: true, json: async () => ({ CardID: '55000' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const cardId = await resolveOptimaCardId(CONFIG, { phone972: '972500000000', firstName: 'יובל' })
    expect(cardId).toBe('55000')
  })

  it('returns null (does not throw) when both search and contact creation fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => null })))
    const cardId = await resolveOptimaCardId(CONFIG, { phone972: '972500000000' })
    expect(cardId).toBeNull()
  })

  // קרה בפועל (24/08, אחרי עדכון גרסה של אופטימה): יצירת כרטיס נכשלה
  // (result_status != '0') כשלא סופק last_name בכלל, והצליחה מיד עם שם
  // משפחה. לרוב אין לנו שם משפחה אמיתי — לא ממציאים שם אנושי מזויף,
  // משתמשים במספר הטלפון (בפורמט המקומי) כמזהה שקוף במקום לשלוח ריק
  it('falls back to the local phone number as last_name when none is given, instead of sending an empty field', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.includes('/search_patient')) return { ok: true, json: async () => ({ patients: {} }) }
      return { ok: true, json: async () => ({ CardID: '55001' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    await resolveOptimaCardId(CONFIG, { phone972: '972503952745', firstName: 'יובל' })
    const createCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/create_contact'))
    const url = new URL(String(createCall![0]))
    expect(url.searchParams.get('last_name')).toBe('0503952745')
  })
})

describe('fetchOptimaAppointments', () => {
  it('flattens the appointments object into an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ appointments: { '1': { AppointmentID: 1, FullName: 'א' }, '2': { AppointmentID: 2, FullName: 'ב' } } }),
    })))
    const r = await fetchOptimaAppointments(CONFIG, '01/08/2026', '30/08/2026')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.appointments).toHaveLength(2)
  })

  it('returns ok:false with the server detail message on failure (e.g. the 504 we saw for an inactive company)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504, json: async () => ({ detail: 'Timeout waiting for WS response' }) })))
    const r = await fetchOptimaAppointments(CONFIG, '01/08/2026', '30/08/2026')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Timeout waiting for WS response')
  })
})
