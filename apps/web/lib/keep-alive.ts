import { after } from 'next/server';
import { recordFailure as record, type Classified, type FailureContext } from '@tesserafy/ai';

/**
 * A write that must outlive the response: a failure row, a usage row.
 *
 * A function can be frozen once it has answered, and a promise nobody awaits
 * is cut off with it. Failure rows are what `pnpm health` alarms on and cost
 * rows cannot be backfilled, so neither may be lost to timing. Next's after()
 * keeps the function alive until the write is done, and may be called from
 * inside another after().
 */
export function keepAlive(work: Promise<unknown>): void {
  after(() => work);
}

/** recordFailure, with its write kept alive past the response. */
export function recordFailure(cause: unknown, context: FailureContext): Classified {
  return record(cause, { ...context, waitUntil: keepAlive });
}
