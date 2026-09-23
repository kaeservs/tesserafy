import { redact } from '@tesserafy/ingest';
import type { SupabaseClient } from '@tesserafy/db';

/**
 * Where a failure goes.
 *
 * Nothing was broken about this product's error handling when three tiers were
 * down for four merges: every route caught the exception, returned a clean 502
 * and an accurate message. It told the end user's browser, which cannot act on
 * it, and nobody else. A failure had no destination. This is the destination.
 *
 * Two things here are not obvious.
 *
 * The first is that classification happens before storage, not at read time. A
 * 400 saying a parameter is deprecated is a bug in us that somebody must fix
 * today; a 529 is the weather and fixes itself. Recording both as "error" is
 * how a log becomes wallpaper, and wallpaper is what we already had.
 *
 * The second is that the message is scrubbed. An upstream error is happy to
 * quote the request back at you — that is what makes upstream errors useful —
 * so a model rejection can carry a sentence from a customer's call and an auth
 * failure can carry the key that failed. The redactor this product already
 * runs at T0 handles the first. Credentials need their own pass, because they
 * are not customer identifiers and T0 has no reason to know about them.
 */

/** What kind of failure it was, which decides whether anyone must act. */
export type FailureKind =
  | 'model_rejected'
  | 'model_unavailable'
  | 'database'
  | 'input'
  | 'unknown';

export interface Classified {
  readonly kind: FailureKind;
  readonly message: string;
  readonly status?: number;
}

const CREDENTIALS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sbp_[A-Za-z0-9]+/g,
  /gh[pousr]_[A-Za-z0-9]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  // A Supabase service-role key is a JWT, and a JWT in a log is a live key.
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
  /(?<=[Bb]earer )[A-Za-z0-9._-]{12,}/g,
];

/** As long as a message stays useful to read, and no longer. */
const MAX_MESSAGE = 2000;

export function scrub(message: string): string {
  let text = message;
  for (const pattern of CREDENTIALS) text = text.replace(pattern, '[credential]');
  // T0's redactor second, so a masked credential cannot be mistaken for a
  // phone number by the digit rule.
  text = redact(text).text;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/**
 * What went wrong, from whatever was thrown.
 *
 * Structural, not `instanceof`: this has to classify an Anthropic SDK error, a
 * PostgREST error object and a bare string, and importing three error classes
 * to compare against would make a pure function depend on all three.
 */
export function classify(cause: unknown): Classified {
  const error = cause as { status?: unknown; code?: unknown; details?: unknown; name?: unknown };
  const message = scrub(
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause),
  );

  // PostgREST hands back a five-character SQLSTATE and a details field. Our own
  // database refusing us is never the same problem as a model refusing us.
  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return { kind: 'database', message };
  }

  if (typeof error?.status === 'number') {
    const status = error.status;
    // 429 sits with the outages on purpose. It is the upstream saying "not
    // now", not "not like that", and waiting is the whole fix.
    if (status === 429 || status >= 500) return { kind: 'model_unavailable', status, message };
    if (status >= 400) return { kind: 'model_rejected', status, message };
  }

  if (error?.name === 'ZodError') return { kind: 'input', message };

  // A socket that never answered has no status. Grouping it with the outages
  // is right: nothing was rejected, the request never landed.
  if (/\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|aborted)\b/i.test(message)) {
    return { kind: 'model_unavailable', message };
  }

  return { kind: 'unknown', message };
}

export interface FailureContext {
  readonly db: SupabaseClient;
  /** Where it happened, as a human says it: 'api/suggest', 'script/score'. */
  readonly source: string;
  readonly tier?: 't1' | 't2' | 't3';
  readonly model?: string;
  readonly companyId?: string;
  readonly conversationId?: string;
  /** Called when recording the failure itself fails. */
  readonly onError?: (error: Error) => void;
}

/**
 * Records and returns, never throws and never waits.
 *
 * The rule the usage sink set: measuring must not break the thing being
 * measured. It is worse here. This runs inside a catch block, so a throw would
 * replace a real failure with a failure about failing, and an await would add
 * a database round trip to the latency of a request that has already gone
 * wrong for the person waiting on it.
 */
export function recordFailure(cause: unknown, context: FailureContext): Classified {
  const classified = classify(cause);
  void send(classified, context);
  return classified;
}

async function send(classified: Classified, context: FailureContext): Promise<void> {
  try {
    const { error } = await context.db.rpc('record_failure', {
      p_source: context.source,
      p_kind: classified.kind,
      p_message: classified.message,
      // See the usage sink: an argument with `default null` is omitted rather
      // than sent as null, and under exactOptionalPropertyTypes omitting means
      // a spread rather than an explicit undefined.
      ...(context.tier ? { p_tier: context.tier } : {}),
      ...(context.model ? { p_model: context.model } : {}),
      ...(classified.status === undefined ? {} : { p_status: classified.status }),
      ...(context.companyId ? { p_company_id: context.companyId } : {}),
      ...(context.conversationId ? { p_conversation_id: context.conversationId } : {}),
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (context.onError) context.onError(error);
    else console.warn(`failure not recorded: ${error.message}`);
  }
}
