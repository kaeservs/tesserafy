import { defineCriteriaSet, type CriteriaSet } from '@tesserafy/scoring';
import type { CriterionRow } from '@tesserafy/db';
import type { CriterionPrompt } from '@tesserafy/ai';

/**
 * Criteria come from the database (`criteria_definitions`), not from here.
 *
 * These two functions are the only translation: rows into the prompts T1 is
 * given, and rows into the set the scoring engine validates. `defineCriteriaSet`
 * is what rejects a row with impossible thresholds, so a bad row fails at load
 * rather than producing a quietly wrong score.
 */

export function toPrompts(rows: readonly CriterionRow[]): CriterionPrompt[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    definition: row.definition,
  }));
}

export function toScorecard(rows: readonly CriterionRow[]): CriteriaSet {
  const first = rows[0];
  if (!first) throw new Error('toScorecard() was given no criteria');

  return defineCriteriaSet({
    engagementType: first.engagement_type,
    version: first.version,
    criteria: rows.map((row) => ({
      key: row.key,
      label: row.label,
      weight: row.weight,
      thresholds: {
        candidate: row.candidate_threshold,
        confirm: row.confirm_threshold,
        corroboratingSegments: row.corroborating_segments,
      },
    })),
  });
}
