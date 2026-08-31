import { z } from 'zod';
import { ApiError } from './api';

const MAX_BODY_BYTES = 128 * 1024;

/**
 * Reads and validates a JSON request body. Rejects wrong content-type,
 * oversized payloads, malformed JSON, and anything that fails the schema -
 * all before the handler touches the database.
 */
export async function parseJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new ApiError('INVALID_REQUEST', 415, 'Expected application/json.');
  }
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, 'Could not read request body.');
  }
  if (raw.length > MAX_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
  }

  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, 'Malformed JSON.');
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(
      'VALIDATION_FAILED',
      400,
      first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request.',
    );
  }
  return parsed.data;
}

export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 400, 'Invalid query parameters.');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const matric = z.string().trim().min(3).max(60);
const personName = z.string().trim().min(2).max(120);
const id = z.coerce.number().int().positive();
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .nullable();

export const verifySchema = z.object({
  matricNumber: matric,
  name: personName,
  electionId: id,
});

export const submitSchema = z.object({
  matricNumber: matric,
  name: personName,
  electionId: id,
  idempotencyKey: z.string().trim().min(16).max(128),
  selections: z
    .array(z.object({ positionId: id, candidateId: id }))
    .min(1)
    .max(100),
});

export const createElectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  votingStart: isoDateTime.optional(),
  votingEnd: isoDateTime.optional(),
});

export const patchElectionSchema = z
  .object({
    version: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['draft', 'scheduled', 'open', 'closed']).optional(),
    votingStart: isoDateTime.optional(),
    votingEnd: isoDateTime.optional(),
    eligibilityMode: z.enum(['restricted', 'open']).optional(),
    maxVoters: z.number().int().positive().max(1_000_000).nullable().optional(),
    resultsPublic: z.boolean().optional(),
  })
  .strict();

export const addPositionSchema = z
  .object({
    positionId: id.optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.positionId != null || (v.name != null && v.name.length > 0), {
    message: 'name or positionId is required',
  });

export const patchPositionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    displayOrder: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => v.name != null || v.displayOrder != null, { message: 'nothing to update' });

export const addCandidateSchema = z.object({
  positionId: id,
  name: z.string().trim().min(1).max(200),
});

export const patchCandidateSchema = patchPositionSchema;

export const addVotersSchema = z
  .object({
    voterIds: z.array(id).max(5000).optional(),
    csv: z.string().max(1_000_000).optional(),
  })
  .refine((v) => (v.voterIds && v.voterIds.length > 0) || (v.csv && v.csv.trim().length > 0), {
    message: 'nothing to add',
  });

export const createVoterSchema = z.object({
  matricNumber: matric,
  name: personName,
});

export const patchVoterSchema = z
  .object({
    matricNumber: matric.optional(),
    name: personName.optional(),
  })
  .refine((v) => v.matricNumber != null || v.name != null, { message: 'nothing to update' });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
