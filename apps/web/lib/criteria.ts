import { defineCriteriaSet, type CriteriaSet } from '@tesserafy/scoring';
import type { CriterionPrompt } from '@tesserafy/ai';

/**
 * The discovery scorecard.
 *
 * Criteria are seed data, not code — a new engagement type should be a row,
 * not a deploy. This lives here because the criteria table does not exist yet
 * and P6 needs something to score against; moving it into the database is part
 * of that work, and until then this constant is the single copy the live path
 * and the eval corpus share.
 *
 * Weights are equal. Weighting them differently is a product judgement about
 * what a good discovery call is, and nobody has made it yet — equal weights at
 * least make the score legible: it is the share of criteria confirmed.
 */
export const DISCOVERY_CRITERIA: readonly CriterionPrompt[] = [
  {
    key: 'pain_quantified',
    label: 'Pain quantified',
    definition:
      'The customer states what a problem costs them in time, money, headcount or accuracy. A complaint with no size is not enough.',
  },
  {
    key: 'current_process_known',
    label: 'Current process known',
    definition:
      'The customer describes how the work is done today — the tools, the steps or who does it.',
  },
  {
    key: 'desired_outcome_stated',
    label: 'Desired outcome stated',
    definition:
      'The customer says what they want instead, either as a request or by describing how they would like it to work.',
  },
  {
    key: 'timeline_stated',
    label: 'Timeline stated',
    definition:
      'The customer names a date, deadline or period for the change they are considering. Scheduling the next meeting does not count.',
  },
  {
    key: 'budget_indicated',
    label: 'Budget indicated',
    definition:
      'The customer refers to budget, funding, price sensitivity or when money can be committed.',
  },
];

/** The same criteria as the scoring engine needs them: weights and thresholds. */
export const DISCOVERY_SCORECARD: CriteriaSet = defineCriteriaSet({
  engagementType: 'discovery',
  version: 1,
  criteria: DISCOVERY_CRITERIA.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    weight: 1,
  })),
});
