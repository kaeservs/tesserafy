import { recordFailure } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { NextResponse } from 'next/server';

/**
 * What a caller is told when the database refuses a request.
 *
 * Our own functions refuse with a code that says why and a sentence written
 * for the person, prefixed with the function's name: `append_live_segment:
 * that session has ended`. Those are passed on without the prefix. Anything
 * else — a constraint name, a column, a type error, a timeout — describes
 * the schema rather than the request, so the caller gets a plain "that did
 * not work" and the error is recorded where `pnpm health` will see it
 * (security review, 2026-10-04: routes answered with the database's message
 * as it came).
 */

const SAID: Record<string, number> = {
  '22023': 400, // invalid_parameter_value: the request asked for something not allowed
  '42501': 403, // insufficient_privilege
  P0002: 404, //   no_data_found
  '23505': 409, // unique_violation, as our functions raise it: already done
  '23514': 409, // check_violation, as our functions raise it: not in a state for that
};

const OWN_MESSAGE = /^[a-z_]+: (.+)$/s;

export interface DatabaseError {
  readonly code?: string;
  readonly message: string;
}

export function refusal(error: DatabaseError, where: { db: SupabaseClient; source: string }): { status: number; message: string } {
  const status = error.code ? SAID[error.code] : undefined;
  const own = OWN_MESSAGE.exec(error.message);
  if (status && own?.[1]) return { status, message: own[1] };
  recordFailure(error, { db: where.db, source: where.source });
  return { status: 502, message: 'That did not work, and it has been recorded. Try again in a moment.' };
}

export function refused(error: DatabaseError, where: { db: SupabaseClient; source: string }): NextResponse {
  const { status, message } = refusal(error, where);
  return NextResponse.json({ error: message }, { status });
}
