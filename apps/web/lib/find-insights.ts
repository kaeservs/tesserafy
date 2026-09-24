import Anthropic from '@anthropic-ai/sdk';
import {
  awaitableDatabaseSink,
  clusterSignals,
  createSupabaseEmbedder,
  groupSignature,
  loadDeclined,
  loadSignals,
  rememberDecline,
  synthesiseInsight,
  T3_SYNTHESISER,
  toCompanyId,
  writeInsight,
} from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { publicSupabaseEnv } from './env';

/**
 * "Look for patterns across your calls", as the customer.
 *
 * The same three steps `pnpm insights` runs — group signals whose evidence
 * says the same thing across calls, have Opus write each group up, store it
 * as a proposed insight — but under the customer's own session, which ADR 0011
 * made possible: the vector search refuses any company they are not a member
 * of, and `record_insight` refuses any signal from another company.
 *
 * Nothing it produces is published. Every insight lands as proposed and waits
 * for a person to approve it, which is also the answer to the embedding
 * model's known weakness — it sometimes groups unrelated requests by phrasing
 * alone, and a reviewer rejects that in a minute. Opus gets a say first:
 * synthesis declines a group that is similar words rather than one finding.
 *
 * Signals already cited by an insight are left out, as the operator script
 * does, so pressing the button twice does not propose the same finding twice.
 */

/**
 * Groups written up per press. Each is one Opus call; this bounds a single
 * press at a handful of them however much has piled up, and the next press
 * picks up where this one stopped because cited signals are skipped.
 */
export const MAX_GROUPS_PER_RUN = 5;

export interface FindOutcome {
  readonly signals: number;
  readonly groups: number;
  readonly proposed: number;
  readonly declined: number;
  /** Groups found beyond the per-press limit, left for the next press. */
  readonly remaining: number;
  /** Groups already judged not to be one finding, and not sent to Opus again. */
  readonly alreadyDeclined: number;
}

export class NoSingleCompany extends Error {}

export async function findInsights(
  db: SupabaseClient,
  userId: string,
  accessToken: string,
  client: Anthropic = new Anthropic(),
): Promise<FindOutcome> {
  // retrieve() requires a company, and a person in two companies has to say
  // which; nobody is in two yet, so that case is refused rather than guessed.
  const { data: memberships, error: membershipError } = await db
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId);
  if (membershipError) throw new Error(`Reading membership failed: ${membershipError.message}`);
  if (!memberships || memberships.length !== 1) {
    throw new NoSingleCompany('This account belongs to more than one company, or to none.');
  }
  const companyId = toCompanyId(memberships[0]!.company_id);

  const signals = await loadSignals(companyId, db, { includeCited: false });
  if (signals.length === 0) {
    return { signals: 0, groups: 0, proposed: 0, declined: 0, remaining: 0, alreadyDeclined: 0 };
  }

  const clustered = await clusterSignals(companyId, signals, {
    db,
    embedder: createSupabaseEmbedder({ url: publicSupabaseEnv().url, token: accessToken }),
  });

  // A group Opus already judged is not one finding is not paid for twice.
  const declinedBefore = await loadDeclined(companyId, db);
  const groups = clustered.filter(
    (group) => !declinedBefore.has(groupSignature(group.signals.map((signal) => signal.id))),
  );

  const usage = awaitableDatabaseSink({ db, companyId, detector: T3_SYNTHESISER });
  let proposed = 0;
  let declined = 0;
  for (const group of groups.slice(0, MAX_GROUPS_PER_RUN)) {
    const result = await synthesiseInsight(group, { client, onUsage: usage.sink });
    if ('reason' in result) {
      declined += 1;
      // Remembered only when it is a verdict. A synthesis that cited signals
      // it was never given is a fault, and the group deserves another try.
      if (result.reason === 'declined' || result.reason === 'too-narrow') {
        await rememberDecline(
          companyId,
          group.signals.map((signal) => signal.id),
          result.reason,
          T3_SYNTHESISER,
          db,
        );
      }
      continue;
    }
    await writeInsight(companyId, result, { db, asMember: true });
    proposed += 1;
  }
  await usage.settled();

  return {
    signals: signals.length,
    groups: groups.length,
    proposed,
    declined,
    remaining: Math.max(0, groups.length - MAX_GROUPS_PER_RUN),
    alreadyDeclined: clustered.length - groups.length,
  };
}
