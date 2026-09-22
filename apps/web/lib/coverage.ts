import type { ConversationScore } from './scorecard';

/**
 * How often each criterion actually gets established, per criteria set.
 *
 * The per-set part is the whole point. This used to take the first scored
 * conversation's criteria as a template and count matches across every
 * meeting, which was correct while one set existed and quietly wrong the
 * moment a second did: a renewal call holds none of the discovery keys, so it
 * counted as a meeting that had failed to establish every one of them. The
 * denominator said thirty and meant twelve, and nothing about the page looked
 * broken.
 *
 * Comparing a renewal conversation against discovery criteria is not a harder
 * question than comparing two discovery calls — it is a meaningless one. So
 * each set is counted on its own, over only the meetings scored against it.
 */

export interface CriterionCoverage {
  readonly key: string;
  readonly label: string;
  readonly confirmed: number;
  readonly candidate: number;
}

export interface SetCoverage {
  /** e.g. `discovery/v1`. */
  readonly label: string;
  /** Meetings scored against this set. The denominator, and never a total. */
  readonly total: number;
  readonly criteria: readonly CriterionCoverage[];
}

export interface CoverableConversation {
  readonly id: string;
  readonly engagement_type: string;
  readonly criteria_version: number;
}

export function coverageBySet(
  conversations: readonly CoverableConversation[],
  scores: ReadonlyMap<string, ConversationScore>,
): SetCoverage[] {
  const groups = new Map<string, CoverableConversation[]>();
  for (const conversation of conversations) {
    const label = `${conversation.engagement_type}/v${conversation.criteria_version}`;
    const group = groups.get(label);
    if (group) group.push(conversation);
    else groups.set(label, [conversation]);
  }

  return [...groups.entries()].map(([label, group]) => {
    // The set's own display order, which is also the order of the pips, so
    // the two read together down the page.
    const template = scores.get(group[0]!.id)?.scorecard.criteria ?? [];

    return {
      label,
      total: group.length,
      criteria: template.map((criterion) => {
        let confirmed = 0;
        let candidate = 0;
        for (const conversation of group) {
          const match = scores
            .get(conversation.id)
            ?.scorecard.criteria.find((c) => c.key === criterion.key);
          if (match?.status === 'confirmed') confirmed += 1;
          else if (match?.status === 'candidate') candidate += 1;
        }
        return { key: criterion.key, label: criterion.label, confirmed, candidate };
      }),
    };
  });
}
