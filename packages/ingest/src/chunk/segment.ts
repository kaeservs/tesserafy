/**
 * Turns into segments — the unit of evidence, and therefore the unit a quote
 * can point at.
 *
 * Two forces pull in opposite directions. Evidence should be human-shaped: a
 * quote lands inside something a person actually said, and the UI scrolls to
 * it. Embeddings should be bounded: one twenty-minute monologue as a single
 * vector retrieves badly, because its meaning is averaged away.
 *
 * So: merge consecutive cues from the same speaker, then split the result at a
 * sentence boundary once it grows past the budget. Boundaries stay where a
 * sentence ends, which is where a quote would naturally stop anyway.
 *
 * Pure. No model decides any of this (tier T0).
 */
import type { SegmentDraft, Turn } from '../types';

export interface ChunkOptions {
  /**
   * Character budget before a turn is split. The default is ~600 tokens at
   * the usual four-characters-a-token rule of thumb — the window spike S3
   * tests detectors against, so a segment fits one detector call.
   */
  readonly maxChars?: number;
  /**
   * A gap this long ends a segment even when the same person resumes. A long
   * pause is a change of subject far more often than it is a breath.
   */
  readonly maxGapMs?: number;
}

const DEFAULT_MAX_CHARS = 2400;
const DEFAULT_MAX_GAP_MS = 5_000;

export function toSegments(turns: readonly Turn[], options: ChunkOptions = {}): SegmentDraft[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  if (!Number.isInteger(maxChars) || maxChars < 80) {
    throw new RangeError(`maxChars must be an integer of at least 80, got ${maxChars}`);
  }
  if (!Number.isInteger(maxGapMs) || maxGapMs < 0) {
    throw new RangeError(`maxGapMs must be a non-negative integer, got ${maxGapMs}`);
  }

  const segments: SegmentDraft[] = [];
  for (const merged of mergeTurns(turns, maxGapMs)) {
    for (const piece of splitTurn(merged, maxChars)) {
      segments.push({ ...piece, index: segments.length });
    }
  }
  return segments;
}

/** Consecutive cues from one speaker, with no long silence between them. */
function mergeTurns(turns: readonly Turn[], maxGapMs: number): Turn[] {
  const merged: Turn[] = [];

  for (const turn of turns) {
    const text = turn.text.trim();
    if (text.length === 0) continue;

    const previous = merged[merged.length - 1];
    const continues =
      previous !== undefined &&
      previous.speaker === turn.speaker &&
      turn.startMs - previous.endMs <= maxGapMs;

    if (continues) {
      merged[merged.length - 1] = {
        speaker: previous.speaker,
        startMs: previous.startMs,
        endMs: Math.max(previous.endMs, turn.endMs),
        text: `${previous.text} ${text}`,
      };
    } else {
      merged.push({ ...turn, text });
    }
  }

  return merged;
}

/**
 * Splits one merged turn into pieces no longer than the budget.
 *
 * Timestamps for the pieces are interpolated by character position, since the
 * source only timed the whole turn. That is an approximation — people do not
 * speak at a constant rate — and it is why evidence always cites a segment
 * rather than a character offset into the recording.
 */
function splitTurn(turn: Turn, maxChars: number): Omit<SegmentDraft, 'index'>[] {
  if (turn.text.length <= maxChars) {
    return [{ speaker: turn.speaker, startMs: turn.startMs, endMs: turn.endMs, text: turn.text }];
  }

  const pieces: Omit<SegmentDraft, 'index'>[] = [];
  const total = turn.text.length;
  const durationMs = turn.endMs - turn.startMs;
  let consumed = 0;
  let remaining = turn.text;

  while (remaining.length > 0) {
    const take = remaining.length <= maxChars ? remaining.length : breakPoint(remaining, maxChars);
    const text = remaining.slice(0, take).trim();
    const startMs = turn.startMs + Math.round((consumed / total) * durationMs);
    consumed += take;
    const endMs = turn.startMs + Math.round((consumed / total) * durationMs);

    if (text.length > 0) {
      pieces.push({ speaker: turn.speaker, startMs, endMs, text });
    }
    remaining = remaining.slice(take);
  }

  return pieces;
}

/**
 * How many characters to take: the last sentence end within the budget, else
 * the last word boundary, else the budget itself. A word boundary beats
 * cutting mid-word; nothing beats a sentence.
 */
function breakPoint(text: string, maxChars: number): number {
  const window = text.slice(0, maxChars);

  const sentence = /[.!?]["')\]]?(?=\s)/g;
  let lastSentenceEnd = -1;
  for (let match = sentence.exec(window); match !== null; match = sentence.exec(window)) {
    lastSentenceEnd = match.index + match[0].length;
  }
  // A sentence end in the first fifth would leave a stub and force the rest
  // into needlessly many pieces.
  if (lastSentenceEnd > maxChars / 5) return lastSentenceEnd;

  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > maxChars / 5) return lastSpace;

  return maxChars;
}
