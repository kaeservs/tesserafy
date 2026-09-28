/**
 * Customers that need someone: a deal still open that has gone quiet, or a
 * last call that went badly. Two rules, both blunt on purpose — a list that
 * flags half the customers is a list nobody reads.
 */

const DAY = 86_400_000;

/** An open deal with no call for this long has gone quiet. */
export const QUIET_DEAL_DAYS = 21;
/** A last call scoring under this is worth a look before the next. */
export const LOW_SCORE = 40;

export interface AttentionAccount {
  readonly id: string;
  readonly name: string;
  readonly latestOutcome: string | null;
  readonly lastCallAt: string | null;
  /** The newest call's score, when it was scored. */
  readonly lastScore: number | null;
}

export type AttentionReason = 'quiet' | 'low score';

export function needsAttention(account: AttentionAccount, now: Date): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (
    account.latestOutcome === 'open' &&
    account.lastCallAt !== null &&
    (now.getTime() - Date.parse(account.lastCallAt)) / DAY >= QUIET_DEAL_DAYS
  ) {
    reasons.push('quiet');
  }
  if (account.lastScore !== null && account.lastScore < LOW_SCORE && account.latestOutcome !== 'lost' && account.latestOutcome !== 'won') {
    reasons.push('low score');
  }
  return reasons;
}

/** The ones needing someone, the longest quiet first. */
export function accountsNeedingAttention<T extends AttentionAccount>(
  accounts: readonly T[],
  now: Date,
): (T & { reasons: AttentionReason[] })[] {
  return accounts
    .map((account) => ({ ...account, reasons: needsAttention(account, now) }))
    .filter((account) => account.reasons.length > 0)
    .sort((a, b) => (a.lastCallAt ?? '').localeCompare(b.lastCallAt ?? '') || a.name.localeCompare(b.name));
}
