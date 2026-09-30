import { redact } from '@tesserafy/ingest';
import type { SupabaseClient } from '@tesserafy/db';
import { liveAvailable, myCompanyId } from './company';

/**
 * What the live endpoints (/api/detect, /api/suggest, /api/live/*) accept.
 *
 * Their input comes from the client, and some of it goes straight into a
 * model's prompt: without bounds, one signed-in account could send a window
 * near the model's context limit thousands of times a day for the price of a
 * few live seconds each. A live window is the last few utterances, so the
 * bounds sit well above anything a real call sends and far below that.
 *
 * And live text is redacted here, as an imported transcript is before it is
 * stored (packages/ingest): email addresses, phone numbers and account-length
 * digit runs spoken on a call reach neither the database nor a prompt. The
 * redaction is deterministic, so a quote the detector takes from a redacted
 * window is found again in the redacted segment it is recorded against.
 */
export const LIVE_LIMITS = {
  segments: 12,
  text: 2_000,
  speaker: 80,
  criteria: 20,
  key: 64,
  label: 80,
  definition: 800,
  /** A scorecard for suggestions, as JSON. */
  scorecard: 20_000,
} as const;

const shortString = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;

export function redactLive(text: string): string {
  return redact(text).text;
}

/**
 * A live window, bounded and redacted, or null when it is not one. Fields
 * other than the text are kept as they were sent.
 */
export function liveWindow<T extends { id: string; text: string; speaker: string | null }>(window: unknown): T[] | null {
  if (!Array.isArray(window) || window.length === 0 || window.length > LIVE_LIMITS.segments) return null;
  for (const segment of window as unknown[]) {
    const item = segment as Partial<T> | null;
    if (!item || !shortString(item.id, 100) || !shortString(item.text, LIVE_LIMITS.text)) return null;
    if (item.speaker !== null && item.speaker !== undefined && !shortString(item.speaker, LIVE_LIMITS.speaker)) return null;
  }
  return (window as T[]).map((segment) => ({ ...segment, text: redactLive(segment.text) }));
}

/** Criteria for the detector: the same bounds a scorecard has when it is written. */
export function liveCriteria<T extends { key: string; label: string; definition: string }>(criteria: unknown): T[] | null {
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > LIVE_LIMITS.criteria) return null;
  for (const criterion of criteria as unknown[]) {
    const item = criterion as Partial<T> | null;
    if (
      !item ||
      !shortString(item.key, LIVE_LIMITS.key) ||
      !shortString(item.label, LIVE_LIMITS.label) ||
      !shortString(item.definition, LIVE_LIMITS.definition)
    ) {
      return null;
    }
  }
  return criteria as T[];
}

/** A scorecard for suggestions: small enough to be one. */
export function liveScorecard(scorecard: unknown): boolean {
  if (!scorecard || typeof scorecard !== 'object') return false;
  const criteria = (scorecard as { criteria?: unknown }).criteria;
  if (!Array.isArray(criteria) || criteria.length > LIVE_LIMITS.criteria) return false;
  return JSON.stringify(scorecard).length <= LIVE_LIMITS.scorecard;
}

const PLAN_TTL_MS = 5 * 60_000;
const planCache = new Map<string, { plan: string | null; at: number }>();

/**
 * Whether this person's company may use live at all. The pages hide Live from
 * every plan but internal (lib/company, liveAvailable); the endpoints ask too,
 * or hiding it would be the only thing in the way. Cached for a few minutes
 * per person: detection has a latency budget, and a plan changes rarely.
 */
export async function liveAllowedFor(db: SupabaseClient, userId: string): Promise<boolean> {
  const cached = planCache.get(userId);
  if (cached && Date.now() - cached.at < PLAN_TTL_MS) return liveAvailable(cached.plan ?? undefined);
  const companyId = await myCompanyId(db, userId);
  const { data } = companyId ? await db.from('companies').select('plan').eq('id', companyId).maybeSingle() : { data: null };
  const plan = data?.plan ?? null;
  planCache.set(userId, { plan, at: Date.now() });
  return liveAvailable(plan ?? undefined);
}
