import type { CoachingCall } from './coaching';

/**
 * The team heatmap: each seller against each criterion of one scorecard, the
 * share of their scored calls that established it. Who asks about budget and
 * who never does, at a glance — and so who to pair with whom.
 *
 * A cell with fewer than MIN_CALLS scored calls behind it is left empty rather
 * than shown as a rate: one call is an anecdote, not a habit.
 */

export const MIN_CALLS = 2;

export interface HeatCell {
  readonly calls: number;
  /** 0 to 1, or null with too few calls. */
  readonly rate: number | null;
}

export interface Heatmap {
  readonly criteria: readonly { key: string; label: string }[];
  readonly rows: readonly { seller: string; calls: number; cells: readonly HeatCell[] }[];
}

export function teamHeatmap(calls: readonly CoachingCall[], engagementType: string): Heatmap {
  const scored = calls.filter((call) => call.score !== null && call.engagementType === engagementType && call.addedBy !== null);
  // The criteria as the newest call names them.
  const newest = [...scored].sort((a, b) => b.date.localeCompare(a.date))[0];
  const criteria = (newest?.criteria ?? []).map(({ key, label }) => ({ key, label }));
  const sellers = [...new Set(scored.map((call) => call.addedBy!))];
  const rows = sellers
    .map((seller) => {
      const theirs = scored.filter((call) => call.addedBy === seller);
      const cells = criteria.map((criterion) => {
        const carrying = theirs.filter((call) => call.criteria.some((c) => c.key === criterion.key));
        const met = carrying.filter((call) => call.criteria.some((c) => c.key === criterion.key && c.status === 'confirmed')).length;
        return { calls: carrying.length, rate: carrying.length >= MIN_CALLS ? met / carrying.length : null };
      });
      return { seller, calls: theirs.length, cells };
    })
    .sort((a, b) => b.calls - a.calls || a.seller.localeCompare(b.seller));
  return { criteria, rows };
}
