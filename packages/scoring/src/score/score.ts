import type { CriterionDefinition, CriterionState, CriterionStatus, RecordedSpan, ScorecardState } from '../types';

/**
 * What confirmation is still waiting on.
 *
 * The scorecard said which criteria were unconfirmed and never what they
 * needed, which leaves the one question somebody looking at a live scorecard
 * actually has — "what would settle this?" — answerable only by reading the
 * thresholds out of the database.
 *
 * Computed here because the rule lives here. Working it out in a page would
 * be a second implementation of the confirm rule, and the second one drifts:
 * it would keep saying "one more mention" long after the engine stopped
 * agreeing.
 *
 * Every span that survives is already at or above the candidate threshold —
 * weaker evidence is discarded rather than recorded — so the counts below are
 * of evidence that already qualifies.
 */
export interface CriterionShortfall {
  /** Distinct segments carrying evidence. */
  readonly segments: number;
  /** Distinct segments that would confirm this by corroboration. */
  readonly segmentsNeeded: number;
  /** Strongest confidence observed, or null when nothing has been. */
  readonly bestConfidence: number | null;
  /** A single span at or above this confirms on its own. */
  readonly confirmingConfidence: number;
}

export interface CriterionScore {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly status: CriterionStatus;
  /** The weight this criterion contributes: its weight if confirmed, else 0. */
  readonly earned: number;
  readonly evidence: readonly RecordedSpan[];
  readonly contradictions: readonly RecordedSpan[];
  /**
   * What would confirm this, or null once it is confirmed.
   *
   * Present for a contradicted criterion too: a contradiction is not final,
   * and fresh evidence can carry it back, so what that would take is still
   * worth knowing.
   */
  readonly shortfall: CriterionShortfall | null;
}

export interface Scorecard {
  readonly engagementType: string;
  readonly criteriaVersion: number;
  /** 0–100, unrounded. Round only for display. */
  readonly score: number;
  readonly earnedWeight: number;
  readonly totalWeight: number;
  /** In criteria-set order. Answers "why is it 72?". */
  readonly criteria: readonly CriterionScore[];
}

/** score = sum(weight of confirmed) / sum(weight of all) * 100 */
export function score(state: ScorecardState): Scorecard {
  const { criteriaSet } = state;

  const criteria = criteriaSet.criteria.map((definition): CriterionScore => {
    const current = state.criteria[definition.key]!;
    return {
      key: definition.key,
      label: definition.label,
      weight: definition.weight,
      status: current.status,
      earned: current.status === 'confirmed' ? definition.weight : 0,
      evidence: current.evidence,
      contradictions: current.contradictions,
      shortfall: current.status === 'confirmed' ? null : shortfallOf(current, definition),
    };
  });

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const earnedWeight = criteria.reduce((sum, c) => sum + c.earned, 0);

  return {
    engagementType: criteriaSet.engagementType,
    criteriaVersion: criteriaSet.version,
    score: (earnedWeight / totalWeight) * 100,
    earnedWeight,
    totalWeight,
    criteria,
  };
}

function shortfallOf(
  current: CriterionState,
  definition: CriterionDefinition,
): CriterionShortfall {
  const segments = new Set(current.evidence.map((recorded) => recorded.span.segmentId));
  const best = current.evidence.reduce<number | null>(
    (highest, recorded) => (highest === null || recorded.confidence > highest ? recorded.confidence : highest),
    null,
  );

  return {
    segments: segments.size,
    segmentsNeeded: definition.thresholds.corroboratingSegments,
    bestConfidence: best,
    confirmingConfidence: definition.thresholds.confirm,
  };
}
