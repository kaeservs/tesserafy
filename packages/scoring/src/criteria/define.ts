import type { CriteriaSet, CriterionDefinition, Thresholds } from '../types';

/** The thresholds ADR 0003 specifies. A criterion may override them. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  candidate: 0.55,
  confirm: 0.8,
  corroboratingSegments: 2,
};

export interface CriterionInput {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly thresholds?: Partial<Thresholds>;
}

export interface CriteriaSetInput {
  readonly engagementType: string;
  readonly version: number;
  readonly criteria: readonly CriterionInput[];
}

/**
 * Validates seed data into a CriteriaSet. Criteria come from the database, so
 * a bad row must fail loudly here rather than produce a quietly wrong score.
 */
export function defineCriteriaSet(input: CriteriaSetInput): CriteriaSet {
  if (input.engagementType.trim().length === 0) {
    throw new Error('engagementType is required');
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`version must be a positive integer, got ${input.version}`);
  }
  if (input.criteria.length === 0) {
    throw new Error('A criteria set needs at least one criterion');
  }

  const seen = new Set<string>();
  const criteria = input.criteria.map((c): CriterionDefinition => {
    if (c.key.trim().length === 0) throw new Error('Criterion key is required');
    if (seen.has(c.key)) throw new Error(`Duplicate criterion key: ${c.key}`);
    seen.add(c.key);

    if (!Number.isFinite(c.weight) || c.weight <= 0) {
      throw new Error(`Criterion ${c.key}: weight must be a positive number, got ${c.weight}`);
    }

    const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...c.thresholds };
    const { candidate, confirm, corroboratingSegments } = thresholds;
    if (!(candidate > 0 && candidate <= confirm && confirm <= 1)) {
      throw new Error(
        `Criterion ${c.key}: thresholds need 0 < candidate <= confirm <= 1, got ${candidate} / ${confirm}`,
      );
    }
    if (!Number.isInteger(corroboratingSegments) || corroboratingSegments < 1) {
      throw new Error(
        `Criterion ${c.key}: corroboratingSegments must be a positive integer, got ${corroboratingSegments}`,
      );
    }

    return { key: c.key, label: c.label, weight: c.weight, thresholds };
  });

  return { engagementType: input.engagementType, version: input.version, criteria };
}
