/**
 * The overlay's three buttons, what each answer looks like, and what is kept.
 *
 * AI Assist, To Ask and Recap each read the call so far (/api/assist). Words
 * to say are a conversation: the customer's line on the right, what to say to
 * it on the left, so there is one place to look for the words. The last
 * answer each button gave in this call is kept: going back to one shows it at
 * once, saying how long ago it was written, and costs nothing. Only pressing
 * the button whose answer is on screen, or Refresh, asks again. A new call
 * forgets them all, since one sitting can hold several calls.
 */

/** The buttons, by the /api/assist mode each asks, and the label each wears. */
export const BUTTON_LABELS = {
  say: 'AI Assist',
  followups: 'To Ask',
  recap: 'Recap',
} as const;
export type ButtonMode = keyof typeof BUTTON_LABELS;

export function isButtonMode(value: string): value is ButtonMode {
  return Object.hasOwn(BUTTON_LABELS, value);
}

/**
 * What pressing a button does: ask again when its answer is already the one
 * on screen, show the one kept from earlier in the call, or ask for the first.
 */
export function pressAction(mode: ButtonMode, shown: ButtonMode | null, kept: boolean): 'ask' | 'recall' {
  if (shown === mode) return 'ask';
  return kept ? 'recall' : 'ask';
}

/** How long ago an answer was written, as its header says it. */
export function sinceLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

/** The name over the customer's lines: the prep's person by first name, else "Them". */
export function theirName(person: string | null | undefined): string {
  return person?.trim().split(/\s+/)[0] || 'Them';
}

/** A point as /api/assist returns it, already checked against what it quotes. */
export interface AssistPoint {
  readonly text: string;
  readonly quote: string | null;
  readonly segmentId: string | null;
  readonly document: string | null;
  readonly fromScreen?: boolean;
}

/** A line of the call, as the overlay keeps it. */
export interface CallLine {
  readonly id: string;
  readonly speaker: string | null;
  readonly text: string;
}

/**
 * A line to say. `them` is the customer's whole line it answers, shown beside
 * it; `source` is the words it rests on when they are not the customer's (a
 * document, the prep, the screen, or the seller's own line), shown under it.
 */
export interface Reply {
  readonly say: string;
  readonly them: string | null;
  readonly source: string | null;
}

export function quoted(point: AssistPoint): string | null {
  if (!point.quote) return null;
  if (point.fromScreen) return `“${point.quote}” — on your screen`;
  return point.document ? `“${point.quote}” — ${point.document}` : `“${point.quote}”`;
}

export function replyOf(point: AssistPoint, lines: readonly CallLine[]): Reply {
  const line = point.segmentId ? lines.find((candidate) => candidate.id === point.segmentId) : undefined;
  if (line && line.speaker !== 'seller') return { say: point.text, them: line.text, source: null };
  return { say: point.text, them: null, source: quoted(point) };
}

/** To Ask holds this many questions: someone mid-conversation cannot read a longer list. */
export const TO_ASK_MAX = 3;

/**
 * To Ask: the prep's questions the scorecard has not seen answered first, then
 * questions the call prompted (/api/assist followups), up to three. When the
 * prep fills it, the model is not asked at all.
 */
export function toAskReplies(prepOpen: readonly string[], followups: readonly AssistPoint[]): Reply[] {
  const fromPrep = prepOpen.slice(0, TO_ASK_MAX).map((say) => ({ say, them: null, source: null }));
  const asked = new Set(fromPrep.map((reply) => reply.say.toLowerCase()));
  const prompted = followups
    .filter((point) => !asked.has(point.text.toLowerCase()))
    .map((point) => ({ say: point.text, them: null, source: null }));
  return [...fromPrep, ...prompted].slice(0, TO_ASK_MAX);
}

export function toAskNeedsModel(prepOpen: readonly string[]): boolean {
  return prepOpen.length < TO_ASK_MAX;
}
