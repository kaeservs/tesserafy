/**
 * The prep's questions during a call: each is done once the live scorecard
 * has confirmed the criterion it was asked for. A question is a reminder, not
 * a score — whether it was met is the scorecard's to say, from what was
 * heard, never from the question having been asked.
 */

export interface PreparedQuestion {
  readonly key: string;
  readonly label: string;
  readonly ask: string;
}

export function questionsToAsk(
  questions: readonly PreparedQuestion[],
  criteria: readonly { key: string; status: string }[],
): { ask: string; label: string; done: boolean }[] {
  const confirmed = new Set(criteria.filter((criterion) => criterion.status === 'confirmed').map((criterion) => criterion.key));
  return questions.map((question) => ({ ask: question.ask, label: question.label, done: confirmed.has(question.key) }));
}
