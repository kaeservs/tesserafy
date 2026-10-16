/**
 * What the overlay puts first during a call: what to say next, drawn as a
 * conversation — the customer's line on the right, the words to say on the
 * left. The live suggestion when there is one (/api/suggest, about what the
 * customer just said); until there is, the prep's next question the scorecard
 * has not yet seen answered; and when there is neither, a line saying it is
 * listening. Each says where it comes from, so a question from the prep is
 * never taken for one the call prompted.
 */
import { questionsToAsk, type PreparedQuestion } from './to-ask';
import type { CallLine } from './answers';

export interface Suggestion {
  readonly ask: string;
  /** The customer's words it answers to. */
  readonly because: string;
  /** The line those words are from, when the server says. */
  readonly segmentId?: string;
}

export interface SayNext {
  /** The words to say: the live suggestion or the prep's question. */
  readonly say: string;
  /** The customer's whole line it answers; null when it answers nothing said. */
  readonly them: string | null;
  /** The live suggestion, the prep's next question, or nothing yet (shown quieter). */
  readonly from: 'live' | 'prep' | 'waiting';
}

export function sayNext(
  suggestion: Suggestion | null,
  questions: readonly PreparedQuestion[],
  criteria: readonly { key: string; status: string }[],
  lines: readonly CallLine[] = [],
): SayNext {
  if (suggestion) {
    const line = suggestion.segmentId ? lines.find((candidate) => candidate.id === suggestion.segmentId) : undefined;
    return { say: suggestion.ask, them: line?.text ?? suggestion.because, from: 'live' };
  }
  const open = questionsToAsk(questions, criteria).find((question) => !question.done);
  if (open) return { say: open.ask, them: null, from: 'prep' };
  return { say: 'What to say next shows here as the customer talks.', them: null, from: 'waiting' };
}
