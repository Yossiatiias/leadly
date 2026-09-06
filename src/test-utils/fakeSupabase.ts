// ─── לקוח Supabase מזויף, לשימוש בבדיקות בלבד ───────────────────────────────
// ORM זעיר בזיכרון שתומך בדיוק בשרשראות השאילתות שה-routes האמיתיים
// משתמשים בהן (select/eq/in/gte/lte/order/limit/single/maybeSingle/or/
// insert/update/delete) — לא תחליף כללי ל-Supabase, רק מספיק כדי להריץ
// את הקוד האמיתי של ai-respond/webhook בבדיקה בלי רשת אמיתית.

type Row = Record<string, any>

function matchOr(row: Row, expr: string): boolean {
  // "audience.eq.customer,audience.eq.both,audience.is.null" וכו'
  return expr.split(',').some(clause => {
    const m = clause.match(/^(\w+)\.(eq|is)\.(.+)$/)
    if (!m) return false
    const [, col, op, val] = m
    if (op === 'is') return val === 'null' ? row[col] == null : row[col] === val
    return String(row[col]) === val
  })
}

// שגיאת אינדקס ייחודי מדומה — מתורגמת ל-{data:null, error} לפני שהיא יוצאת
// מ-FakeQuery, בדיוק כמו שקוד אמיתי מקבל מ-Supabase (השגיאה מוחזרת, לא נזרקת)
class UniqueViolation extends Error {
  code = '23505'
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = []
  private orderCol?: string
  private orderAsc = true
  private limitN?: number

  constructor(private db: FakeDb, private table: string, private op: 'select' | 'insert' | 'update' | 'delete', private payload?: any) {}

  select(_cols?: string) { return this }
  eq(col: string, val: any) { this.filters.push(r => r[col] === val); return this }
  neq(col: string, val: any) { this.filters.push(r => r[col] !== val); return this }
  in(col: string, vals: any[]) { this.filters.push(r => vals.includes(r[col])); return this }
  gt(col: string, val: any) { this.filters.push(r => r[col] > val); return this }
  gte(col: string, val: any) { this.filters.push(r => r[col] >= val); return this }
  lt(col: string, val: any) { this.filters.push(r => r[col] < val); return this }
  lte(col: string, val: any) { this.filters.push(r => r[col] <= val); return this }
  or(expr: string) { this.filters.push(r => matchOr(r, expr)); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this }
  limit(n: number) { this.limitN = n; return this }

  private matched(): Row[] {
    const rows = this.db.tables[this.table] || []
    let result = rows.filter(r => this.filters.every(f => f(r)))
    if (this.orderCol) {
      const col = this.orderCol
      result = [...result].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (this.orderAsc ? 1 : -1))
    }
    if (this.limitN != null) result = result.slice(0, this.limitN)
    return result
  }

  // מריץ את הכתיבה בפועל. זורק UniqueViolation במקרה של התנגשות —
  // כל קריאה חיצונית (maybeSingle/single/then) תופסת את זה ומתרגמת
  // ל-{data:null, error}, בדיוק כמו שהקוד האמיתי מצפה לקבל מ-Supabase.
  private runWrite(): Row[] {
    this.db.tables[this.table] = this.db.tables[this.table] || []
    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
      // מדמה אינדקס ייחודי אמיתי (כמו messages.whatsapp_message_id) —
      // ראה supabase/messages_dedup_migration.sql
      const uniqueCols = this.db.uniqueConstraints[this.table] || []
      for (const col of uniqueCols) {
        for (const r of rows) {
          if (r[col] == null) continue
          const clash = this.db.tables[this.table].some(existing => existing[col] === r[col])
          if (clash) throw new UniqueViolation(`duplicate key value violates unique constraint on ${this.table}.${col}`)
        }
      }
      const inserted = rows.map(r => ({ id: r.id || this.db.nextId(this.table), created_at: new Date().toISOString(), ...r }))
      this.db.tables[this.table].push(...inserted)
      return inserted
    }
    if (this.op === 'update') {
      const targets = this.matched()
      for (const t of targets) Object.assign(t, this.payload)
      return targets
    }
    if (this.op === 'delete') {
      const targets = new Set(this.matched())
      this.db.tables[this.table] = this.db.tables[this.table].filter(r => !targets.has(r))
      return []
    }
    return []
  }

  private runWriteSafe(): { rows: Row[]; error: { code: string; message: string } | null } {
    try {
      return { rows: this.runWrite(), error: null }
    } catch (e) {
      if (e instanceof UniqueViolation) return { rows: [], error: { code: e.code, message: e.message } }
      throw e
    }
  }

  async maybeSingle() {
    const forced = this.db.consumeForcedError(this.table, this.op, this.payload)
    if (forced) return { data: null, error: forced }
    if (this.op === 'select') return { data: this.matched()[0] ?? null, error: null }
    const { rows, error } = this.runWriteSafe()
    if (error) return { data: null, error }
    return { data: rows[0] ?? null, error: null }
  }

  async single() {
    const forced = this.db.consumeForcedError(this.table, this.op, this.payload)
    if (forced) return { data: null, error: forced }
    if (this.op === 'select') {
      const rows = this.matched()
      if (rows.length === 0) return { data: null, error: { message: 'no rows' } }
      return { data: rows[0], error: null }
    }
    const { rows, error } = this.runWriteSafe()
    if (error) return { data: null, error }
    if (rows.length === 0) return { data: null, error: { message: 'no rows' } }
    return { data: rows[0], error: null }
  }

  // מאפשר `await` ישיר בלי .single()/.maybeSingle() — כמו בקוד האמיתי
  then(resolve: (v: { data: Row[] | null; error: any }) => void) {
    const forced = this.db.consumeForcedError(this.table, this.op, this.payload)
    if (forced) { resolve({ data: null, error: forced }); return }
    if (this.op === 'select') {
      resolve({ data: this.matched(), error: null })
      return
    }
    const { rows, error } = this.runWriteSafe()
    resolve({ data: error ? null : rows, error })
  }
}

// ─── מוק אחסון (Storage) — תומך רק ב-upload/getPublicUrl, כפי שנדרש ─────────
// ע"י webhook/route.ts לשמירת קבצים שנשלחו בוואטסאפ (בקט lead-files)
class FakeStorageBucket {
  constructor(private db: FakeDb, private bucket: string) {}

  async upload(path: string, _data: any, _opts?: any) {
    this.db.storageFiles.push({ bucket: this.bucket, path })
    return { data: { path }, error: null }
  }

  getPublicUrl(path: string) {
    return { data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${this.bucket}/${path}` } }
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  uniqueConstraints: Record<string, string[]> = {}
  storageFiles: Array<{ bucket: string; path: string }> = []
  private counters: Record<string, number> = {}
  private forcedErrors: Record<string, Array<{ remaining: number; match?: (payload: any) => boolean }>> = {}

  nextId(table: string): string {
    this.counters[table] = (this.counters[table] || 0) + 1
    return `${table}-${this.counters[table]}`
  }

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows
  }

  setUniqueConstraint(table: string, cols: string[]) {
    this.uniqueConstraints[table] = cols
  }

  // ─── הזרקת כשל מדומה — בדיקת נתיבי error-handling אמיתיים ──────────────────
  // (ביקורת קוד — נקודות 1/2): קוד שבודק error מ-Supabase צריך בדיקה
  // שבאמת מדמה כישלון, לא רק את מסלול ה-happy-path. גורם לקריאה הבאה
  // שתואמת table+op (ואופציונלית match על ה-payload, כדי לפגוע בדיוק
  // בקריאה הרצויה כשאותה טבלה מתעדכנת כמה פעמים באותה ריצה — למשל
  // conversations מתעדכן גם לנעילת עיבוד וגם למגדר וגם לאסקלציה) להחזיר
  // {data:null, error} במקום להצליח כרגיל — בדיוק כמו שהקוד האמיתי
  // מקבל מ-Supabase בכשל אמיתי (timeout, RLS, וכו')
  failNextWrite(
    table: string, op: 'select' | 'insert' | 'update' | 'delete',
    opts: { times?: number; match?: (payload: any) => boolean } = {}
  ) {
    const key = `${table}:${op}`
    this.forcedErrors[key] = this.forcedErrors[key] || []
    this.forcedErrors[key].push({ remaining: opts.times ?? 1, match: opts.match })
  }

  consumeForcedError(table: string, op: string, payload?: any): { message: string; code: string } | null {
    const key = `${table}:${op}`
    const list = this.forcedErrors[key]
    if (!list?.length) return null
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]
      if (entry.match && !entry.match(payload)) continue
      entry.remaining--
      if (entry.remaining <= 0) list.splice(i, 1)
      return { message: `forced test error on ${key}`, code: 'FORCED_TEST_ERROR' }
    }
    return null
  }

  client() {
    return {
      from: (table: string) => ({
        select: (cols?: string) => new FakeQuery(this, table, 'select'),
        insert: (payload: any) => new FakeQuery(this, table, 'insert', payload),
        update: (payload: any) => new FakeQuery(this, table, 'update', payload),
        delete: () => new FakeQuery(this, table, 'delete'),
      }),
      storage: {
        from: (bucket: string) => new FakeStorageBucket(this, bucket),
      },
    }
  }
}
