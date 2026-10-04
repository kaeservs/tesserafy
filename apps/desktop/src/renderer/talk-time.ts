import { words } from './hearing';

/**
 * Who is doing the talking, live — possible now that the two sides are heard
 * apart (ADR 0022). Counted in words, as the call page counts it (lib/talk),
 * so the overlay and the dashboard tell the same story.
 *
 * A nudge when the seller has done most of the talking lately: arithmetic,
 * not the model's opinion, and rare — not in the first minutes, not on a
 * handful of words, and not again for a while once said.
 */

/** "Lately": the last five minutes. */
export const RECENT_MS = 5 * 60_000;
/** Most of the talking: two words in three, or more. */
export const TOO_MUCH = 0.65;
/** Enough said to judge by. */
export const ENOUGH_WORDS = 120;
/** Not before this far into the call: openings are the seller's. */
export const SETTLED_MS = 3 * 60_000;
/** Once said, not again for this long. */
export const QUIET_AFTER_NUDGE_MS = 5 * 60_000;

export interface Shares {
  readonly me: number;
  readonly them: number;
  readonly words: number;
}

export class TalkMeter {
  private said: { at: number; side: 'me' | 'them'; words: number }[] = [];
  private nudgedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly startedAt: number) {}

  heard(side: 'me' | 'them', text: string, at: number): void {
    const count = words(text).length;
    if (count > 0) this.said.push({ at, side, words: count });
  }

  /** Each side's share of the words, over the whole call or since `since`. */
  shares(since = Number.NEGATIVE_INFINITY): Shares {
    let me = 0;
    let them = 0;
    for (const line of this.said) {
      if (line.at < since) continue;
      if (line.side === 'me') me += line.words;
      else them += line.words;
    }
    const total = me + them;
    return { me: total === 0 ? 0 : me / total, them: total === 0 ? 0 : them / total, words: total };
  }

  /** What to say to the seller now, if anything. */
  nudge(at: number): string | null {
    if (at - this.startedAt < SETTLED_MS || at - this.nudgedAt < QUIET_AFTER_NUDGE_MS) return null;
    const recent = this.shares(at - RECENT_MS);
    if (recent.words < ENOUGH_WORDS || recent.me < TOO_MUCH) return null;
    this.nudgedAt = at;
    return `You’ve done ${Math.round(recent.me * 100)}% of the talking in the last five minutes. Ask, then let them talk.`;
  }
}
