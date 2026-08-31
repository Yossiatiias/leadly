// ─── Green API helpers ────────────────────────────────────────────────────────
// instance_id נשמר במסד לפעמים עם קידומת ("Instance 710722691468") ולפעמים בלי.
// שימוש בערך הגולמי בונה URL שבור (waInstanceInstance 710...) שמחזיר 404.
// כל בניית URL ל-Green API חייבת לעבור דרך הפונקציות כאן.

export function cleanInstanceId(raw: string | null | undefined): string {
  // trim לפני ואחרי — רווח מוביל (הדבקה לשדה) לא ימנע את הסרת הקידומת
  return (raw || '').trim().replace(/^Instance\s+/i, '').trim()
}

export function greenApiUrl(
  apiUrl: string | null | undefined,
  instanceId: string | null | undefined,
  method: string,
  token: string | null | undefined,
  query = ''
): string {
  const base = (apiUrl || 'https://7107.api.greenapi.com').replace(/\/$/, '')
  return `${base}/waInstance${cleanInstanceId(instanceId)}/${method}/${token}${query}`
}
