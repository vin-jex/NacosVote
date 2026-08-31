import { NextResponse } from 'next/server';
import { requireAdmin } from './auth';
import { categorizePgError } from './db';
import { log, newRequestId, safeError } from './log';

export const runtime = 'nodejs';

/**
 * Consistent API error envelope: { error: { code, message } }.
 * `code` is stable and machine-readable; `message` is safe to show a user and
 * never contains SQL, stack traces, hostnames, or connection strings.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function fail(code: string, httpStatus: number, message: string, requestId?: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status: httpStatus, headers: requestId ? { 'x-request-id': requestId } : undefined },
  );
}

export function ok<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: init?.requestId ? { 'x-request-id': init.requestId } : undefined,
  });
}

export function parseId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Wraps a route handler. Turns ApiError into its envelope, maps transient
 * database failures to 503 without leaking details, and logs anything
 * unexpected with a request id (no request body, no PII).
 */
export async function handle(
  event: string,
  fn: (ctx: { requestId: string }) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = newRequestId();
  try {
    return await fn({ requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.httpStatus, err.message, requestId);
    }
    const category = categorizePgError(err);
    if (category === 'connection' || category === 'timeout') {
      log.error('db_unavailable', { event, requestId, category, err: safeError(err) });
      return fail(
        'TEMPORARY_ERROR',
        503,
        'The service is temporarily unavailable. Please try again shortly.',
        requestId,
      );
    }
    if (category === 'serialization' || category === 'deadlock') {
      log.warn('db_contention', { event, requestId, category });
      return fail('TEMPORARY_ERROR', 503, 'Please try again.', requestId);
    }
    log.error('unhandled_route_error', { event, requestId, err: safeError(err) });
    return fail('INTERNAL_ERROR', 500, 'Something went wrong on our end.', requestId);
  }
}

/** Returns the admin email or throws ApiError(401). Every admin route calls this. */
export async function adminEmail(): Promise<string> {
  const email = await requireAdmin();
  if (!email) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in required.');
  return email;
}
