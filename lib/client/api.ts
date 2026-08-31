'use client';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; timedOut: boolean };

const DEFAULT_TIMEOUT = 12_000;

/**
 * fetch wrapper with a bounded timeout and a normalised error shape.
 * `timedOut` is true when the client gave up — the server may still have
 * processed the request, so callers on non-idempotent POSTs must treat this as
 * "unknown", never as "failed".
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...rest,
      signal: controller.signal,
      headers: rest.body ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: (body ?? {}) as T };
    return {
      ok: false,
      status: res.status,
      code: body?.error?.code ?? `HTTP_${res.status}`,
      message: body?.error?.message ?? 'Something went wrong. Please try again.',
      timedOut: false,
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      code: aborted ? 'TIMEOUT' : 'NETWORK',
      message: aborted
        ? 'The request took too long.'
        : 'Could not reach the server. Check your connection.',
      timedOut: aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Retry a GET with exponential backoff. Never used for POSTs. */
export async function apiGetWithRetry<T = unknown>(
  path: string,
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const attempts = opts.attempts ?? 3;
  let last: ApiResult<T> | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await apiFetch<T>(path, { timeoutMs: opts.timeoutMs });
    if (last.ok || last.status === 401 || last.status === 404) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i * (0.5 + Math.random())));
  }
  return last as ApiResult<T>;
}
