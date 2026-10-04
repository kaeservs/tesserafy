/**
 * Live captions: the last few things said, as they are said, each side named
 * — Cluely's running transcript, on the overlay.
 *
 * A finished line stays until newer ones push it off; what someone is saying
 * now shows beside it and is replaced as the transcriber revises its guess.
 * The seller's microphone also hears the customer on speakers (hearing.ts), so
 * while the customer is mid-sentence the microphone's guess is not shown: it
 * is almost always the customer's own words again.
 */

export type Side = 'me' | 'them' | null;

export interface CaptionLine {
  readonly side: Side;
  readonly text: string;
  /** Still being said: the words may change. */
  readonly live: boolean;
}

/** How long after the customer's last words the microphone's guess is taken for an echo. */
export const ECHO_QUIET_MS = 1_500;
/** The tail of a long line: the newest words are the ones being read. */
export const MOST_CHARACTERS = 180;

function tail(text: string): string {
  return text.length <= MOST_CHARACTERS ? text : `…${text.slice(-(MOST_CHARACTERS - 1)).trimStart()}`;
}

export class Captions {
  private finished: { side: Side; text: string }[] = [];
  private live = new Map<string, { side: Side; text: string }>();
  private themAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly keep = 3) {}

  /** A piece from the transcriber: words still being said, or a line finished. */
  heard(side: Side, kind: 'interim' | 'utterance', text: string, at: number): void {
    const key = side ?? 'one';
    if (side === 'them') this.themAt = at;
    if (kind === 'utterance') {
      this.live.delete(key);
      if (text.trim()) this.finished.push({ side, text: text.trim() });
      if (this.finished.length > this.keep) this.finished = this.finished.slice(-this.keep);
    } else if (text.trim()) {
      this.live.set(key, { side, text: text.trim() });
    } else {
      this.live.delete(key);
    }
  }

  /** What to show now: the finished lines, then what each side is saying. */
  lines(at: number): CaptionLine[] {
    const live = [...this.live.values()].filter((line) => !(line.side === 'me' && at - this.themAt < ECHO_QUIET_MS));
    return [
      ...this.finished.slice(-Math.max(1, this.keep - live.length)).map((line) => ({ side: line.side, text: tail(line.text), live: false })),
      ...live.map((line) => ({ side: line.side, text: tail(line.text), live: true })),
    ];
  }

  clear(): void {
    this.finished = [];
    this.live.clear();
    this.themAt = Number.NEGATIVE_INFINITY;
  }
}
