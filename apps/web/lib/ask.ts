import type { AskPoint } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';

/**
 * A point of an answer to "Ask your calls", as the page shows it: the quote,
 * and where it was said — the call's page at that line, or the document.
 */
export interface AskedPoint {
  text: string;
  quote: string;
  /** Where it was said: the call's page at that line. */
  href: string | null;
  call: { title: string; occurredAt: string | null; startMs: number; speaker: string | null } | null;
  document: string | null;
}

export function shown(point: AskPoint): AskedPoint {
  return {
    text: point.text,
    quote: point.quote,
    href: point.call ? `/conversations/${point.call.conversationId}#segment-${point.call.segmentId}` : null,
    call: point.call
      ? { title: point.call.title, occurredAt: point.call.occurredAt, startMs: point.call.startMs, speaker: point.call.speaker }
      : null,
    document: point.document,
  };
}

/** How far back Ask may be narrowed, in days. */
export const ASK_PERIODS = [7, 30, 90] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AskFilters {
  readonly accountId: string | null;
  readonly days: (typeof ASK_PERIODS)[number] | null;
}

/** What the request asked to narrow to, and nothing it could not mean. */
export function askFilters(body: { accountId?: unknown; days?: unknown }): AskFilters {
  const accountId = typeof body.accountId === 'string' && UUID.test(body.accountId) ? body.accountId : null;
  const days = ASK_PERIODS.find((period) => period === body.days) ?? null;
  return { accountId, days };
}

/**
 * The calls a narrowed question may search, read as the person asking (RLS),
 * newest first, at most the 2000 the search takes; and the scope in words,
 * for the agent and the person. Null when nothing was narrowed.
 */
export async function askScope(
  db: SupabaseClient,
  filters: AskFilters,
  now: Date = new Date(),
): Promise<{ conversationIds: string[]; text: string } | null> {
  if (!filters.accountId && !filters.days) return null;
  let query = db.from('conversations').select('id').order('created_at', { ascending: false }).limit(2000);
  let account: string | null = null;
  if (filters.accountId) {
    query = query.eq('account_id', filters.accountId);
    const { data } = await db.from('accounts').select('name').eq('id', filters.accountId).maybeSingle();
    account = data?.name ?? 'that account';
  }
  if (filters.days) {
    const since = new Date(now.getTime() - filters.days * 86_400_000).toISOString();
    // When it happened, or when it was added for a call with no date.
    query = query.or(`occurred_at.gte.${since},and(occurred_at.is.null,created_at.gte.${since})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`reading the calls in scope failed: ${error.message}`, { cause: error });
  const parts = [account ? `calls with ${account}` : 'calls', filters.days ? `from the last ${filters.days} days` : ''];
  return { conversationIds: (data ?? []).map((row) => row.id), text: parts.filter(Boolean).join(' ') };
}
