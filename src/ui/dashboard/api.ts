// JSON calls from the dashboard to its routes; errors come back as `{ error }` (src/workflow/http.ts).

export interface ApiResult<T> {
  ok: boolean
  status: number
  body: T & { error?: string; reason?: string; lessonIds?: string[] }
}

export async function sendJson<T = Record<string, never>>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown = {},
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => ({}))) as ApiResult<T>['body']
  return { ok: response.ok, status: response.status, body: parsed }
}

/** The message to show for a failed call. */
export function errorText(result: ApiResult<unknown>): string {
  return result.body.error ?? `The request failed (${result.status}). Try again.`
}
