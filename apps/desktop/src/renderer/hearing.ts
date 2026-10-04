/**
 * Two sides of a call, heard separately (ADR 0022).
 *
 * Without headphones the seller's microphone also hears the customer, played
 * through the speakers, so the customer's sentence arrives twice: once from
 * the computer's sound output, where it belongs, and again from the
 * microphone, as if the seller had said it. Saved as the seller's it would
 * put the customer's words in the seller's mouth on the call record.
 *
 * So a line from the microphone waits a moment, and is dropped when most of
 * its words were just said by the customer. Echo cancellation in the
 * microphone catches some of this; it cannot catch sound another app plays.
 */

/** How far apart the two copies of one sentence arrive. */
export const ECHO_WINDOW_MS = 6_000;
/** How long a line from the microphone waits for its customer copy. */
export const SELLER_HOLD_MS = 1_500;
/** Share of the seller's words the customer just said that makes it an echo. */
const ECHO_SHARE = 0.6;

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export class EchoCheck {
  private theirs: { at: number; words: Set<string> }[] = [];

  /** The customer said this, at this time. */
  heardThem(text: string, at: number): void {
    this.theirs = this.theirs.filter((line) => at - line.at <= ECHO_WINDOW_MS * 2);
    this.theirs.push({ at, words: new Set(words(text)) });
  }

  /** Whether the microphone's line, heard at this time, is the customer's sentence again. */
  isEcho(text: string, at: number): boolean {
    const mine = words(text);
    if (mine.length === 0) return true;
    const near = new Set<string>();
    for (const line of this.theirs) {
      if (Math.abs(line.at - at) <= ECHO_WINDOW_MS) for (const word of line.words) near.add(word);
    }
    if (near.size === 0) return false;
    return mine.filter((word) => near.has(word)).length / mine.length >= ECHO_SHARE;
  }
}
