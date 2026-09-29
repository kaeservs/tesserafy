/**
 * A customer's story across every call with them: how the calls have scored
 * over time, what has been established with them and what is still to find
 * out, and who on their side has been on the calls.
 *
 * "Still to find out" is the part a seller reads before the next call. A
 * criterion confirmed on any call with this customer is established — the
 * budget does not need asking twice — and one confirmed on none is the
 * question to bring. Per scorecard, because a renewal asks different things
 * from a discovery call.
 */

export interface StoryCriterion {
  readonly key: string;
  readonly label: string;
  readonly status: string;
}

export interface StoryCall {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly score: number | null;
  readonly engagementType: string;
  readonly criteria: readonly StoryCriterion[];
}

export interface Coverage {
  readonly engagementType: string;
  /** Confirmed on at least one call, with the call it was first confirmed on. */
  readonly established: readonly { key: string; label: string; callId: string; callTitle: string }[];
  /** Confirmed on none: what to ask next time. */
  readonly stillToFindOut: readonly { key: string; label: string }[];
}

/** Per scorecard, from the scored calls with this customer, oldest first. */
export function customerCoverage(calls: readonly StoryCall[]): Coverage[] {
  const scored = calls.filter((call) => call.score !== null).sort((a, b) => a.date.localeCompare(b.date));
  const types = [...new Set(scored.map((call) => call.engagementType))];
  return types.map((engagementType) => {
    const theirs = scored.filter((call) => call.engagementType === engagementType);
    // The criteria as the newest call names them: the set they are measured on now.
    const current = theirs[theirs.length - 1]!.criteria;
    const established = current.flatMap((criterion) => {
      const first = theirs.find((call) =>
        call.criteria.some((c) => c.key === criterion.key && c.status === 'confirmed'),
      );
      return first ? [{ key: criterion.key, label: criterion.label, callId: first.id, callTitle: first.title }] : [];
    });
    const done = new Set(established.map((criterion) => criterion.key));
    return {
      engagementType,
      established,
      stillToFindOut: current.filter((criterion) => !done.has(criterion.key)).map(({ key, label }) => ({ key, label })),
    };
  });
}

/** The scored calls in order, for a trend: oldest first. */
export function scoreTrend(calls: readonly StoryCall[]): { id: string; date: string; score: number }[] {
  return calls
    .flatMap((call) => (call.score === null ? [] : [{ id: call.id, date: call.date, score: call.score }]))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The customer's people: everyone who spoke on their calls and is not one of
 * yours, by how much they said, with how many calls each was on.
 */
export function theirPeople(
  rows: readonly { conversationId: string; speaker: string | null; words: number }[],
  isOurs: (name: string) => boolean,
): { name: string; calls: number; words: number }[] {
  const people = new Map<string, { calls: Set<string>; words: number }>();
  for (const row of rows) {
    if (row.speaker === null || isOurs(row.speaker)) continue;
    const entry = people.get(row.speaker) ?? { calls: new Set<string>(), words: 0 };
    entry.calls.add(row.conversationId);
    entry.words += row.words;
    people.set(row.speaker, entry);
  }
  return [...people]
    .map(([name, entry]) => ({ name, calls: entry.calls.size, words: entry.words }))
    .sort((a, b) => b.calls - a.calls || b.words - a.words || a.name.localeCompare(b.name));
}
