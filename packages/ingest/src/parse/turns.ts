/**
 * The escape hatch: a transcript already shaped as turns, as JSON.
 *
 * An export format nobody has written a parser for can be mapped to this by
 * hand or by a one-off script and still enter the pipeline through the same
 * door, with the same validation. Test fixtures use it too.
 */
import { TranscriptParseError, type ParsedTranscript, type Turn } from '../types';

interface RawTurn {
  speaker?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  text?: unknown;
}

/**
 * Validates parsed JSON into a transcript.
 *
 * Rejects rather than repairs. A transcript with times running backwards is
 * evidence with wrong timestamps, and evidence nobody can trust is worse than
 * an import that failed loudly.
 */
export function parseTurns(input: unknown, title: string | null = null): ParsedTranscript {
  const raw = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input['turns'])
      ? input['turns']
      : null;

  if (!raw) {
    throw new TranscriptParseError('Expected an array of turns, or an object with a turns array');
  }
  if (raw.length === 0) {
    throw new TranscriptParseError('Transcript contains no turns');
  }

  const sourceTitle =
    title ?? (isRecord(input) && typeof input['title'] === 'string' ? input['title'] : null);

  let previousEnd = -1;
  const turns = raw.map((entry, index): Turn => {
    const position = index + 1;
    if (!isRecord(entry)) {
      throw new TranscriptParseError(`Turn ${position} is not an object`);
    }
    const { speaker, startMs, endMs, text } = entry as RawTurn;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TranscriptParseError(`Turn ${position} has no text`);
    }
    assertTime(startMs, `Turn ${position} startMs`);
    assertTime(endMs, `Turn ${position} endMs`);
    if (endMs < startMs) {
      throw new TranscriptParseError(`Turn ${position} ends (${endMs}ms) before it starts`);
    }
    if (startMs < previousEnd) {
      throw new TranscriptParseError(
        `Turn ${position} starts at ${startMs}ms, before turn ${index} ended at ${previousEnd}ms`,
      );
    }
    previousEnd = endMs;

    if (speaker !== undefined && speaker !== null && typeof speaker !== 'string') {
      throw new TranscriptParseError(`Turn ${position} has a non-string speaker`);
    }

    const name = typeof speaker === 'string' ? speaker.trim() : '';
    return { speaker: name.length > 0 ? name : null, startMs, endMs, text: text.trim() };
  });

  return { title: sourceTitle, turns };
}

function assertTime(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TranscriptParseError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
