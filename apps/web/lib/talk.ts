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

/** Speaker names compare without case or extra spaces, as the database stores them. */
export function speakerKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** What the overlay names the seller when it hears both sides of a call (ADR 0022). */
export const LIVE_SELLER = 'seller';

/**
 * The speakers a call's drafts should treat as yours: the names marked as
 * yours, and the overlay's own label for the seller when the call has it —
 * a line the overlay heard from the microphone is the seller's by where it
 * came from, with no one needing to say so.
 */
export function ourSpeakerNames(marked: readonly { name: string }[] | null, segments: readonly { speaker: string | null }[]): string[] {
  const names = (marked ?? []).map((row) => row.name);
  const live = segments.some((segment) => segment.speaker === LIVE_SELLER);
  return live && !names.some((name) => speakerKey(name) === LIVE_SELLER) ? [...names, LIVE_SELLER] : names;
}

/**
 * Your side against everyone else, once someone has said which names are
 * yours. Null until the call has words on both sides — a call where nobody is
 * marked, or only one side spoke, has no split to show.
 */
export function sideShares(
  speakers: readonly { speaker: string | null; words: number }[],
  ours: ReadonlySet<string>,
): { ours: number; theirs: number } | null {
  let mine = 0;
  let total = 0;
  for (const entry of speakers) {
    total += entry.words;
    if (entry.speaker !== null && ours.has(speakerKey(entry.speaker))) mine += entry.words;
  }
  if (mine === 0 || mine === total) return null;
  return { ours: mine / total, theirs: 1 - mine / total };
}

/**
 * Each seller's share of the talking on their calls: the mean, over the calls
 * they added that have both sides marked, of their side's share. A mean of
 * calls rather than of words, so one long call does not speak for the rest.
 */
export function talkBySeller(
  rows: readonly { conversationId: string; speaker: string | null; words: number }[],
  ours: ReadonlySet<string>,
  addedBy: ReadonlyMap<string, string | null>,
): Map<string, { calls: number; share: number }> {
  const byCall = new Map<string, { speaker: string | null; words: number }[]>();
  for (const row of rows) {
    const list = byCall.get(row.conversationId) ?? [];
    list.push({ speaker: row.speaker, words: row.words });
    byCall.set(row.conversationId, list);
  }
  const sums = new Map<string, { calls: number; total: number }>();
  for (const [conversationId, speakers] of byCall) {
    const seller = addedBy.get(conversationId);
    const split = sideShares(speakers, ours);
    if (!seller || !split) continue;
    const entry = sums.get(seller) ?? { calls: 0, total: 0 };
    entry.calls += 1;
    entry.total += split.ours;
    sums.set(seller, entry);
  }
  return new Map([...sums].map(([seller, entry]) => [seller, { calls: entry.calls, share: entry.total / entry.calls }]));
}
