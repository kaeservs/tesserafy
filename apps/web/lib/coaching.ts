/**
 * Coaching: which criteria go with wins, and how one seller compares.
 *
 * Pure, fed the scorecards every page already computes (invariant 1 keeps
 * scores out of the database). Two cautions are built in rather than left to
 * the reader:
 *
 *   * Small numbers. Nothing is compared until there are at least
 *     MIN_DECIDED won and MIN_DECIDED lost calls (or scored calls, for a
 *     seller), and every rate travels with the count it rests on.
 *   * Association, not cause. A criterion met more often on won calls may be
 *     a habit worth coaching or a symptom of a deal that was going well
 *     anyway. The pages say which of the two this cannot tell apart.
 *
 * Criteria are compared within one scorecard: a "Budget named" on a demo
 * scorecard is not the same question as one on discovery. Versions of a
 * scorecard are pooled by criterion key, because a key is how the owner said
 * "this is the same criterion" when they published the next version.
 */

export const MIN_DECIDED = 3;

export type Outcome = 'won' | 'lost' | 'open';

/** The stored column, narrowed; anything else is "nobody has said". */
export function asOutcome(value: string | null): Outcome | null {
  return value === 'won' || value === 'lost' || value === 'open' ? value : null;
}

export interface CoachingCall {
  readonly id: string;
  readonly title: string;
  /** The meeting's date, or the day it was added. */
  readonly date: string;
  readonly addedBy: string | null;
  readonly engagementType: string;
  readonly outcome: Outcome | null;
  /** The customer the call was with, when anyone said. */
  readonly accountId?: string | null;
  /** Null when nothing was heard: not scored, which is not zero. */
  readonly score: number | null;
  readonly criteria: readonly { key: string; label: string; status: string }[];
}

export interface CriterionAgainstOutcome {
  readonly key: string;
  readonly label: string;
  /** Share of won calls where it was confirmed. */
  readonly wonRate: number;
  readonly lostRate: number;
  /** wonRate − lostRate: positive goes with winning. */
  readonly gap: number;
}

export interface OutcomeComparison {
  readonly engagementType: string;
  readonly won: number;
  readonly lost: number;
  /** Enough decided calls on both sides to compare at all. */
  readonly enough: boolean;
  /** Largest gap first; empty unless `enough`. */
  readonly criteria: readonly CriterionAgainstOutcome[];
}

function confirmedShare(calls: readonly CoachingCall[], key: string): number {
  const seen = calls.filter((call) => call.criteria.some((c) => c.key === key));
  if (seen.length === 0) return 0;
  return seen.filter((call) => call.criteria.some((c) => c.key === key && c.status === 'confirmed')).length / seen.length;
}

/** For each scorecard, how often each criterion was met on won calls against lost ones. */
export function criteriaByOutcome(calls: readonly CoachingCall[]): OutcomeComparison[] {
  const decided = calls.filter((call) => call.score !== null && (call.outcome === 'won' || call.outcome === 'lost'));
  const byType = new Map<string, CoachingCall[]>();
  for (const call of decided) byType.set(call.engagementType, [...(byType.get(call.engagementType) ?? []), call]);

  return [...byType.entries()]
    .map(([engagementType, group]) => {
      const won = group.filter((call) => call.outcome === 'won');
      const lost = group.filter((call) => call.outcome === 'lost');
      const enough = won.length >= MIN_DECIDED && lost.length >= MIN_DECIDED;

      // The newest label for each key, since a later version may reword it.
      const labels = new Map<string, { label: string; date: string }>();
      for (const call of group) {
        for (const criterion of call.criteria) {
          const seen = labels.get(criterion.key);
          if (!seen || call.date > seen.date) labels.set(criterion.key, { label: criterion.label, date: call.date });
        }
      }

      const criteria = enough
        ? [...labels.entries()]
            .map(([key, { label }]) => {
              const wonRate = confirmedShare(won, key);
              const lostRate = confirmedShare(lost, key);
              return { key, label, wonRate, lostRate, gap: wonRate - lostRate };
            })
            .sort((a, b) => b.gap - a.gap || a.label.localeCompare(b.label))
        : [];

      return { engagementType, won: won.length, lost: lost.length, enough, criteria };
    })
    .sort((a, b) => b.won + b.lost - (a.won + a.lost));
}

export interface CriterionAgainstCompany {
  readonly engagementType: string;
  readonly key: string;
  readonly label: string;
  /** Their scored calls that carried this criterion. */
  readonly calls: number;
  readonly rate: number;
  readonly companyRate: number;
}

export interface SellerProfile {
  readonly calls: number;
  readonly scored: number;
  readonly average: number | null;
  readonly companyAverage: number | null;
  readonly outcomes: { readonly won: number; readonly lost: number; readonly open: number; readonly unsaid: number };
  /** won / (won + lost), when at least MIN_DECIDED are decided. */
  readonly winRate: number | null;
  readonly companyWinRate: number | null;
  /** Where they differ most from the company, weakest first. Needs MIN_DECIDED scored calls each. */
  readonly criteria: readonly CriterionAgainstCompany[];
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function winRate(calls: readonly CoachingCall[]): number | null {
  const won = calls.filter((call) => call.outcome === 'won').length;
  const lost = calls.filter((call) => call.outcome === 'lost').length;
  return won + lost >= MIN_DECIDED ? won / (won + lost) : null;
}

/** One seller against the whole company, over the same calls. */
export function sellerProfile(calls: readonly CoachingCall[], sellerId: string): SellerProfile {
  const theirs = calls.filter((call) => call.addedBy === sellerId);
  const scoredTheirs = theirs.filter((call) => call.score !== null);
  const scoredAll = calls.filter((call) => call.score !== null);

  const criteria: CriterionAgainstCompany[] = [];
  const types = new Set(scoredTheirs.map((call) => call.engagementType));
  for (const engagementType of types) {
    const mine = scoredTheirs.filter((call) => call.engagementType === engagementType);
    const everyone = scoredAll.filter((call) => call.engagementType === engagementType);
    const labels = new Map<string, string>();
    for (const call of mine) for (const criterion of call.criteria) labels.set(criterion.key, criterion.label);
    for (const [key, label] of labels) {
      const carried = mine.filter((call) => call.criteria.some((c) => c.key === key));
      if (carried.length < MIN_DECIDED) continue;
      criteria.push({
        engagementType,
        key,
        label,
        calls: carried.length,
        rate: confirmedShare(mine, key),
        companyRate: confirmedShare(everyone, key),
      });
    }
  }
  criteria.sort((a, b) => a.rate - a.companyRate - (b.rate - b.companyRate) || a.label.localeCompare(b.label));

  return {
    calls: theirs.length,
    scored: scoredTheirs.length,
    average: mean(scoredTheirs.map((call) => call.score!)),
    companyAverage: mean(scoredAll.map((call) => call.score!)),
    outcomes: {
      won: theirs.filter((call) => call.outcome === 'won').length,
      lost: theirs.filter((call) => call.outcome === 'lost').length,
      open: theirs.filter((call) => call.outcome === 'open').length,
      unsaid: theirs.filter((call) => call.outcome === null).length,
    },
    winRate: winRate(theirs),
    companyWinRate: winRate(calls),
    criteria,
  };
}

/** "72%", for a share. */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}
