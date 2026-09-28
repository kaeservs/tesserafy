/**
 * Plain-text transcripts, as Otter, Fireflies, Zoom's "save transcript" and a
 * Google Meet transcript copied out of its document produce them. No two agree
 * on a layout, so this reads the handful that turn up:
 *
 *   [00:01:23] Ada Lovelace: text          timestamp, speaker, words on one line
 *   Ada Lovelace (00:01:23): text          speaker, timestamp, words
 *   Ada Lovelace  0:03                     a heading, the words on the lines after
 *   00:05:00                               a timestamp alone, then
 *   Ada Lovelace: text                     lines with a speaker and no time
 *
 * Every piece of evidence needs a time. A line without its own takes the last
 * one above it: Meet stamps every few minutes, and "at or after 00:05:00" is
 * true where a time spread between two stamps would be invented. A turn ends
 * where the next begins. A file with no time at all is refused, because a
 * quote nobody can find in the recording is not evidence.
 *
 * Lines before the first time are the preamble — a meeting name, a list of
 * attendees — and the first of them is taken as the title.
 */
import { TranscriptParseError, withoutBom, type ParsedTranscript, type Turn } from '../types';

const TIME = String.raw`(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)`;
const OPEN = String.raw`[\[(]?`;
const CLOSE = String.raw`[\])]?`;
const DASH = String.raw`(?:\s*[-–—|]\s*|\s+)`;
// A name, not a sentence that happens to contain a colon: short, no sentence
// punctuation, at most four words. The same rule the WebVTT reader uses.
const NAME = String.raw`([^:.!?\[\]()\d][^:.!?\[\]]{0,39}?)`;
const MAX_SPEAKER_WORDS = 4;

const TIME_ONLY = new RegExp(String.raw`^${OPEN}${TIME}${CLOSE}$`);
const TIME_NAME_TEXT = new RegExp(String.raw`^${OPEN}${TIME}${CLOSE}${DASH}${NAME}:\s+(.+)$`);
const NAME_TIME_TEXT = new RegExp(String.raw`^${NAME}\s*[\[(]${TIME}[\])]\s*:?\s+(.+)$`);
const NAME_TIME = new RegExp(String.raw`^\[?${NAME}\]?${DASH}${OPEN}${TIME}${CLOSE}:?$`);
const TIME_NAME = new RegExp(String.raw`^${OPEN}${TIME}${CLOSE}${DASH}${NAME}:?$`);
const TIME_TEXT = new RegExp(String.raw`^${OPEN}${TIME}${CLOSE}\s+(.+)$`);
const NAME_TEXT = new RegExp(String.raw`^${NAME}:\s+(.+)$`);

interface Draft {
  speaker: string | null;
  startMs: number;
  text: string[];
  line: number;
}

export function parseText(source: string): ParsedTranscript {
  const lines = withoutBom(source).split(/\r\n|\r|\n/);
  let title: string | null = null;
  let time: number | null = null;
  const drafts: Draft[] = [];

  const open = (speaker: string | null, startMs: number, text: string | null, line: number) => {
    drafts.push({ speaker, startMs, text: text === null ? [] : [text], line });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    const at = i + 1;
    let match: RegExpExecArray | null;

    if ((match = TIME_ONLY.exec(line))) {
      time = readTime(match[1]!, at);
    } else if ((match = TIME_NAME_TEXT.exec(line)) && isName(match[2]!)) {
      time = readTime(match[1]!, at);
      open(match[2]!.trim(), time, match[3]!, at);
    } else if ((match = NAME_TIME_TEXT.exec(line)) && isName(match[1]!)) {
      time = readTime(match[2]!, at);
      open(match[1]!.trim(), time, match[3]!, at);
    } else if ((match = NAME_TIME.exec(line)) && isName(match[1]!) && looksLikeName(match[1]!)) {
      time = readTime(match[2]!, at);
      open(match[1]!.trim(), time, null, at);
    } else if ((match = TIME_NAME.exec(line)) && isName(match[2]!) && looksLikeName(match[2]!)) {
      time = readTime(match[1]!, at);
      open(match[2]!.trim(), time, null, at);
    } else if ((match = TIME_TEXT.exec(line))) {
      time = readTime(match[1]!, at);
      open(null, time, match[2]!, at);
    } else if (time === null) {
      title ??= line;
    } else if ((match = NAME_TEXT.exec(line)) && isName(match[1]!)) {
      open(match[1]!.trim(), time, match[2]!, at);
    } else if (drafts.length > 0) {
      drafts[drafts.length - 1]!.text.push(line);
    } else {
      open(null, time, line, at);
    }
  }

  if (time === null) {
    throw new TranscriptParseError(
      'No timestamps found. Every quote needs a time in the recording, so export the transcript with timestamps',
    );
  }

  const spoken = drafts.filter((draft) => draft.text.join(' ').trim().length > 0);
  if (spoken.length === 0) {
    throw new TranscriptParseError('Text transcript contains no spoken lines');
  }

  const turns: Turn[] = spoken.map((draft, index) => {
    const next = spoken[index + 1];
    if (next && next.startMs < draft.startMs) {
      throw new TranscriptParseError(`Time goes backwards, to ${formatMs(next.startMs)}`, next.line);
    }
    return {
      speaker: draft.speaker,
      startMs: draft.startMs,
      endMs: next ? next.startMs : draft.startMs,
      text: draft.text.join(' ').replace(/\s+/g, ' ').trim(),
    };
  });

  return { title, turns };
}

function isName(label: string): boolean {
  return label.trim().split(/\s+/).length <= MAX_SPEAKER_WORDS;
}

/**
 * "00:03 Ada Lovelace" is a heading; "00:03 so the budget is fine" is words.
 * Without a colon to go on, a heading is words that each start with a capital
 * or a digit — "Speaker 2", "Grace Hopper (Acme)" — which also keeps "we start
 * at 10:30" from being read as a person called "we start at".
 */
function looksLikeName(label: string): boolean {
  return label
    .trim()
    .split(/\s+/)
    .every((word) => /^[(\p{Lu}\d]/u.test(word));
}

/** `H:MM:SS`, `MM:SS`, either with milliseconds after a dot or a comma. */
function readTime(value: string, line: number): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new TranscriptParseError(`Malformed timestamp "${value}"`, line);
  }
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0]!, parts[1]!];
  return Math.round(((hours! * 60 + minutes!) * 60 + seconds!) * 1000);
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
