/**
 * Who talked, and how: each speaker's share of the words, the questions they
 * asked, and their longest stretch without anyone else speaking.
 *
 * Words, not seconds. A WebVTT cue carries its end, but a text transcript
 * gives some lines only the time of the stamp above them, so seconds would be
 * right for one format and wrong for another; a word count is the same in all
 * of them. The longest stretch still says how long it ran, from the times the
 * transcript does carry.
 *
 * These are counts of the transcript, not judgements, and they are kept apart
 * from the score: nothing here feeds a criterion.
 */

export interface TalkSegment {
  readonly speaker: string | null;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly text: string;
}

export interface SpeakerTalk {
  /** Null for lines the transcript did not attribute to anyone. */
  readonly speaker: string | null;
  readonly words: number;
  /** Of every word in the call, 0 to 1. */
  readonly share: number;
  readonly questions: number;
  /** The longest run of this speaker's segments with nobody else between. */
  readonly longestWords: number;
  readonly longestMs: number;
}

export interface TalkStats {
  readonly words: number;
  /** Most words first. */
  readonly speakers: readonly SpeakerTalk[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** A question mark ends a question; "?!" and "??" are still one. */
export function countQuestions(text: string): number {
  return (text.match(/\?+/g) ?? []).length;
}

export function talkStats(segments: readonly TalkSegment[]): TalkStats {
  const bySpeaker = new Map<string | null, { words: number; questions: number; longestWords: number; longestMs: number }>();
  let run: { speaker: string | null; words: number; startMs: number; endMs: number } | null = null;

  const closeRun = () => {
    if (!run) return;
    const entry = bySpeaker.get(run.speaker)!;
    if (run.words > entry.longestWords) {
      entry.longestWords = run.words;
      entry.longestMs = Math.max(0, run.endMs - run.startMs);
    }
  };

  for (const segment of segments) {
    const words = countWords(segment.text);
    if (words === 0) continue;
    const entry = bySpeaker.get(segment.speaker) ?? { words: 0, questions: 0, longestWords: 0, longestMs: 0 };
    entry.words += words;
    entry.questions += countQuestions(segment.text);
    bySpeaker.set(segment.speaker, entry);

    if (run && run.speaker === segment.speaker) {
      run.words += words;
      run.endMs = Math.max(run.endMs, segment.end_ms);
    } else {
      closeRun();
      run = { speaker: segment.speaker, words, startMs: segment.start_ms, endMs: segment.end_ms };
    }
  }
  closeRun();

  const total = [...bySpeaker.values()].reduce((sum, entry) => sum + entry.words, 0);
  return {
    words: total,
    speakers: [...bySpeaker.entries()]
      .map(([speaker, entry]) => ({ speaker, ...entry, share: total === 0 ? 0 : entry.words / total }))
      .sort((a, b) => b.words - a.words || (a.speaker ?? '').localeCompare(b.speaker ?? '')),
  };
}
