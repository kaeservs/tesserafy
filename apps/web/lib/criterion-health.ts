/**
 * Criterion health: how often people correct the AI on each criterion of a
 * scorecard — "it missed this" (a person added the evidence) and "it was
 * wrong" (a person marked it not met). A criterion corrected often is one
 * whose definition the detector reads differently from the team: the thing to
 * reword in the next version, or to teach with an example (lib/guidance).
 */

export interface Correction {
  readonly criterionKey: string;
  /** 'evidence': the AI missed it. 'contradiction': the AI claimed it wrongly. */
  readonly kind: string;
  readonly reason: string | null;
  readonly quote: string | null;
  readonly createdAt: string;
}

export interface CriterionHealth {
  readonly key: string;
  readonly label: string;
  readonly missed: number;
  readonly wrong: number;
  /** Corrections per scored call on this scorecard, 0 to 1. */
  readonly rate: number;
  /** Corrected often enough to be worth rewording or teaching. */
  readonly attention: boolean;
  readonly latest: readonly { kind: string; reason: string | null; quote: string | null }[];
}

/** At least this many corrections, and on at least this share of calls, before a criterion is flagged. */
export const ATTENTION_MIN = 2;
export const ATTENTION_RATE = 0.1;

export function criterionHealth(
  criteria: readonly { key: string; label: string }[],
  corrections: readonly Correction[],
  scoredCalls: number,
): CriterionHealth[] {
  return criteria
    .map((criterion) => {
      const mine = corrections
        .filter((correction) => correction.criterionKey === criterion.key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const missed = mine.filter((correction) => correction.kind === 'evidence').length;
      const wrong = mine.filter((correction) => correction.kind === 'contradiction').length;
      const rate = scoredCalls === 0 ? 0 : (missed + wrong) / scoredCalls;
      return {
        key: criterion.key,
        label: criterion.label,
        missed,
        wrong,
        rate,
        attention: missed + wrong >= ATTENTION_MIN && rate >= ATTENTION_RATE,
        latest: mine.slice(0, 2).map(({ kind, reason, quote }) => ({ kind, reason, quote })),
      };
    })
    .sort((a, b) => b.missed + b.wrong - (a.missed + a.wrong) || a.label.localeCompare(b.label));
}
