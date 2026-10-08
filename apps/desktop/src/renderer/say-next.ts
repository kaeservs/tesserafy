/**
 * What the overlay puts first during a call: what to say next. The live
 * suggestion when there is one (/api/suggest, about what the customer just
 * said); until there is, the prep's next question the scorecard has not yet
 * seen answered; and when there is neither, a line saying it is listening.
 * Each says where it comes from, so a question from the prep is never taken
 * for one the call prompted.
 */
import { questionsToAsk, type PreparedQuestion } from './to-ask';

export interface Suggestion {
  readonly ask: string;
  /** The customer's words it answers to. */
  readonly because: string;
}

export interface SayNext {
  readonly label: string;
  readonly text: string;
  /** Why this, when there is a reason to give. */
  readonly why: string | null;
  /** Nothing to say yet: shown quieter. */
  readonly waiting: boolean;
}

export function sayNext(
  suggestion: Suggestion | null,
  questions: readonly PreparedQuestion[],
  criteria: readonly { key: string; status: string }[],
): SayNext {
  if (suggestion) {
    return { label: 'Say next', text: suggestion.ask, why: `because they said “${suggestion.because}”`, waiting: false };
  }
  const open = questionsToAsk(questions, criteria).find((question) => !question.done);
  if (open) return { label: 'From your prep', text: open.ask, why: null, waiting: false };
  return { label: 'Listening', text: 'What to say next shows here as the customer talks.', why: null, waiting: true };
}
