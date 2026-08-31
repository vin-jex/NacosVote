import { randomUUID } from 'node:crypto';

type Level = 'info' | 'warn' | 'error';

/**
 * Minimal structured logger. One JSON line per event.
 *
 * NEVER pass ballot selections, and never pass a voter identifier and a
 * candidate identifier in the same event. Matric numbers and full names should
 * not be logged either — pass a hashed/opaque marker if correlation is needed.
 */
function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};

export function newRequestId(): string {
  return randomUUID();
}

/** Strips anything that could carry a payload; keeps only a safe error shape. */
export function safeError(err: unknown): { name: string; message: string; code?: string } {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; code?: string };
    return {
      name: e.name ?? 'Error',
      message: (e.message ?? String(err)).slice(0, 300),
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  return { name: 'Error', message: String(err).slice(0, 300) };
}
