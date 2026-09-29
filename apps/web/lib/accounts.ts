import { batches, readAll, type SupabaseClient } from '@tesserafy/db';
import { asOutcome, type Outcome } from './coaching';
import { scoreConversations } from './scorecard';

/**
 * A customer account and what the brand knows about it: every call, how the
 * latest ended, what the customer has said across them, and what colleagues
 * noted. One read, shared by the account page and the overlay's pre-call
 * brief, so the two cannot tell a seller different things.
 *
 * Read as the signed-in person: RLS bounds it to their company. Scores are
 * computed, as everywhere, never stored.
 */

export interface AccountSummary {
  readonly id: string;
  readonly name: string;
  readonly domain: string | null;
  readonly createdBy: string | null;
  readonly calls: number;
  readonly lastCallAt: string | null;
  readonly latestOutcome: Outcome | null;
}

export interface BriefCall {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly outcome: Outcome | null;
  readonly score: number | null;
  readonly engagementType: string;
  /** Each criterion's state on this call, for what has been established with the customer. */
  readonly criteria: readonly { key: string; label: string; status: string }[];
}

export interface BriefSignal {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly conversationId: string;
  readonly conversationTitle: string;
  readonly quote: string | null;
  readonly segmentId: string | null;
}

export interface BriefNote {
  readonly body: string;
  readonly author: string | null;
  readonly conversationId: string;
  readonly segmentId: string;
  readonly at: string;
}

export interface AccountBrief {
  readonly account: AccountSummary;
  /** Newest first. */
  readonly calls: readonly BriefCall[];
  /** What the customer said across calls — problems and requests, newest call first. */
  readonly signals: readonly BriefSignal[];
  readonly notes: readonly BriefNote[];
}

interface CallRow {
  id: string;
  company_id: string;
  title: string;
  occurred_at: string | null;
  created_at: string;
  outcome: string | null;
  engagement_type: string;
  criteria_version: number;
  account_id: string | null;
}

const CALL_COLUMNS = 'id, company_id, title, occurred_at, created_at, outcome, engagement_type, criteria_version, account_id';

function dateOf(row: { occurred_at: string | null; created_at: string }): string {
  return row.occurred_at ?? row.created_at;
}

/** Every account, with how many calls it has and how the newest ended. */
export async function listAccounts(db: SupabaseClient): Promise<AccountSummary[]> {
  const [accounts, calls] = await Promise.all([
    readAll<{ id: string; name: string; domain: string | null; created_by: string | null }>(
      (from, to) => db.from('accounts').select('id, name, domain, created_by').order('name').order('id').range(from, to),
      'Could not load accounts',
    ),
    readAll<Pick<CallRow, 'id' | 'account_id' | 'occurred_at' | 'created_at' | 'outcome'>>(
      (from, to) =>
        db
          .from('conversations')
          .select('id, account_id, occurred_at, created_at, outcome')
          .not('account_id', 'is', null)
          .order('id')
          .range(from, to),
      'Could not load accounts',
    ),
  ]);
  const byAccount = new Map<string, typeof calls>();
  for (const call of calls) {
    if (call.account_id) byAccount.set(call.account_id, [...(byAccount.get(call.account_id) ?? []), call]);
  }
  return accounts.map((account) => {
    const theirs = (byAccount.get(account.id) ?? []).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    const newest = theirs[0];
    return {
      id: account.id,
      name: account.name,
      domain: account.domain,
      createdBy: account.created_by,
      calls: theirs.length,
      lastCallAt: newest ? dateOf(newest) : null,
      latestOutcome: asOutcome(theirs.find((call) => call.outcome !== null)?.outcome ?? null),
    };
  });
}

/** One account in full, or null if the caller cannot see it. */
export async function accountBrief(db: SupabaseClient, accountId: string): Promise<AccountBrief | null> {
  const { data: account } = await db
    .from('accounts')
    .select('id, name, domain, created_by')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return null;

  const rows = (
    await readAll<CallRow>(
      (from, to) => db.from('conversations').select(CALL_COLUMNS).eq('account_id', accountId).order('id').range(from, to),
      'Could not load the account',
    )
  ).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  const scores = await scoreConversations(db, rows);
  const calls: BriefCall[] = rows.map((row) => {
    const card = scores.get(row.id)?.scorecard;
    const heard = card?.criteria.some((criterion) => criterion.status !== 'unobserved') ?? false;
    return {
      id: row.id,
      title: row.title,
      date: dateOf(row),
      outcome: asOutcome(row.outcome),
      score: card && heard ? card.score : null,
      engagementType: row.engagement_type,
      criteria: (card?.criteria ?? []).map((criterion) => ({ key: criterion.key, label: criterion.label, status: criterion.status })),
    };
  });
  const ids = rows.map((row) => row.id);
  const titleOf = new Map(rows.map((row) => [row.id, row.title]));
  const order = new Map(ids.map((id, index) => [id, index]));

  const [signals, notes] = await Promise.all([
    Promise.all(
      batches(ids).map((chunk) =>
        readAll<{ id: string; conversation_id: string; kind: string; summary: string }>(
          (from, to) =>
            db.from('signals').select('id, conversation_id, kind, summary').in('conversation_id', chunk).order('id').range(from, to),
          'Could not load the account',
        ),
      ),
    ).then((parts) => parts.flat()),
    Promise.all(
      batches(ids).map((chunk) =>
        readAll<{ body: string; author: string | null; conversation_id: string; segment_id: string; created_at: string }>(
          (from, to) =>
            db
              .from('segment_notes')
              .select('body, author, conversation_id, segment_id, created_at')
              .in('conversation_id', chunk)
              .order('id')
              .range(from, to),
          'Could not load the account',
        ),
      ),
    ).then((parts) => parts.flat()),
  ]);

  // One quote per signal: the evidence is what makes a signal worth repeating
  // to a seller about to walk into the call (invariant 5).
  const evidence = (
    await Promise.all(
      batches(signals.map((signal) => signal.id)).map((chunk) =>
        readAll<{ signal_id: string; segment_id: string; quote: string }>(
          (from, to) =>
            db.from('signal_evidence').select('signal_id, segment_id, quote').in('signal_id', chunk).order('id').range(from, to),
          'Could not load the account',
        ),
      ),
    )
  ).flat();
  const firstQuote = new Map<string, { quote: string; segmentId: string }>();
  for (const row of evidence) {
    if (!firstQuote.has(row.signal_id)) firstQuote.set(row.signal_id, { quote: row.quote, segmentId: row.segment_id });
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      domain: account.domain,
      createdBy: account.created_by,
      calls: calls.length,
      lastCallAt: calls[0]?.date ?? null,
      latestOutcome: calls.find((call) => call.outcome !== null)?.outcome ?? null,
    },
    calls,
    signals: signals
      .sort((a, b) => (order.get(a.conversation_id) ?? 0) - (order.get(b.conversation_id) ?? 0))
      .map((signal) => ({
        id: signal.id,
        kind: signal.kind,
        summary: signal.summary,
        conversationId: signal.conversation_id,
        conversationTitle: titleOf.get(signal.conversation_id) ?? '',
        quote: firstQuote.get(signal.id)?.quote ?? null,
        segmentId: firstQuote.get(signal.id)?.segmentId ?? null,
      })),
    notes: notes
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((note) => ({
        body: note.body,
        author: note.author,
        conversationId: note.conversation_id,
        segmentId: note.segment_id,
        at: note.created_at,
      })),
  };
}
