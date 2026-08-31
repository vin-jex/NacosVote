import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness only: the process is up and can serve requests. No dependency checks,
// no infrastructure details.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
