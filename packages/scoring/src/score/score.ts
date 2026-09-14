import type { CriterionStatus, RecordedSpan, ScorecardState } from '../types';

export interface CriterionScore {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly status: CriterionStatus;
  /** The weight this criterion contributes: its weight if confirmed, else 0. */
  readonly earned: number;
  readonly evidence: readonly RecordedSpan[];
  readonly contradictions: readonly RecordedSpan[];
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
