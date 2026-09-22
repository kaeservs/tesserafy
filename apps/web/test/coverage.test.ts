/**
 * Coverage, counted per criteria set.
 *
 * The bug this pins was invisible while one set existed and silent once two
 * did: a renewal call holds none of the discovery keys, so counting every
 * meeting against one template made each renewal call look like a meeting
 * that had failed to establish every discovery criterion. The denominator was
 * wrong and the page looked fine.
 */
import { describe, expect, it } from 'vitest';
import { coverageBySet, type CoverableConversation } from '@/lib/coverage';
import type { ConversationScore } from '@/lib/scorecard';
import type { CriterionStatus } from '@tesserafy/scoring';

function conversation(id: string, type: string): CoverableConversation {
  return { id, engagement_type: type, criteria_version: 1 };
}

function score(
  id: string,
  type: string,
  criteria: [key: string, status: CriterionStatus][],
): [string, ConversationScore] {
  return [
    id,
    {
      conversationId: id,
      engagementType: type,
      criteriaVersion: 1,
      detectors: [],
      scorecard: {
        engagementType: type,
        criteriaVersion: 1,
        score: 0,
        earnedWeight: 0,
        totalWeight: criteria.length,
        criteria: criteria.map(([key, status]) => ({
          key,
          label: key,
          weight: 1,
          status,
          earned: 0,
          evidence: [],
          contradictions: [],
        })),
      },
    } as unknown as ConversationScore,
  ];
}

describe('coverageBySet', () => {
  it('counts each set over only the meetings scored against it', () => {
    const conversations = [
      conversation('d1', 'discovery'),
      conversation('d2', 'discovery'),
      conversation('r1', 'renewal'),
    ];
    const scores = new Map([
      score('d1', 'discovery', [['pain_quantified', 'confirmed']]),
      score('d2', 'discovery', [['pain_quantified', 'unobserved']]),
      score('r1', 'renewal', [['value_realised', 'confirmed']]),
    ]);

    const coverage = coverageBySet(conversations, scores);

    expect(coverage).toHaveLength(2);

    const discovery = coverage.find((set) => set.label === 'discovery/v1')!;
    // Two, not three. The renewal call was never scored against this
    // criterion and must not count as a meeting that failed to establish it.
    expect(discovery.total).toBe(2);
    expect(discovery.criteria[0]).toMatchObject({ key: 'pain_quantified', confirmed: 1 });

    const renewal = coverage.find((set) => set.label === 'renewal/v1')!;
    expect(renewal.total).toBe(1);
    expect(renewal.criteria[0]).toMatchObject({ key: 'value_realised', confirmed: 1 });
  });

  it('separates versions of the same engagement type', () => {
    // v1 and v2 of a set can differ in criteria, thresholds or weights, so
    // pooling them would average two different questions.
    const conversations: CoverableConversation[] = [
      { id: 'a', engagement_type: 'discovery', criteria_version: 1 },
      { id: 'b', engagement_type: 'discovery', criteria_version: 2 },
    ];
    const scores = new Map([
      score('a', 'discovery', [['pain_quantified', 'confirmed']]),
      score('b', 'discovery', [['pain_quantified', 'confirmed']]),
    ]);

    const coverage = coverageBySet(conversations, scores);

    expect(coverage.map((set) => set.label).sort()).toEqual(['discovery/v1', 'discovery/v2']);
    expect(coverage.every((set) => set.total === 1)).toBe(true);
  });

  it('counts candidates apart from confirmations', () => {
    // "Nearly there" and "never mentioned" must not look the same, which is
    // the whole reason the bar has two segments.
    const conversations = [conversation('d1', 'discovery'), conversation('d2', 'discovery')];
    const scores = new Map([
      score('d1', 'discovery', [['budget_indicated', 'candidate']]),
      score('d2', 'discovery', [['budget_indicated', 'unobserved']]),
    ]);

    const coverage = coverageBySet(conversations, scores);

    expect(coverage[0]!.criteria[0]).toMatchObject({ confirmed: 0, candidate: 1 });
  });

  it('returns nothing when nothing has been scored', () => {
    expect(coverageBySet([], new Map())).toEqual([]);
  });
});
