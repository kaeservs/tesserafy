/**
 * WebVTT, the format almost every meeting tool exports: Zoom, Teams, Meet and
 * most standalone transcription services all emit it.
 *
 * Speakers appear two ways in the wild — the spec's voice span,
 * `<v Ada Lovelace>text</v>`, and a bare `Ada Lovelace: text` prefix. Both are
 * read here, because a transcript whose speakers are lost is a transcript that
 * cannot tell a customer's words from a salesperson's.
 */
import { TranscriptParseError, type ParsedTranscript, type Turn } from '../types';

const TIMING = /^(.+?)\s+-->\s+(.+?)(?:\s+.*)?$/;
const VOICE_SPAN = /^<v(?:\.[^\s>]+)*\s+([^>]*)>([\s\S]*?)(?:<\/v>)?$/;
// A speaker label, not a sentence that happens to contain a colon. A name is
// short, unpunctuated and at most a few words: "Grace Hopper", "Speaker 1",
// "Grace Hopper (Acme)". "It comes down to this: we are late" is not one.
const SPEAKER_PREFIX = /^([^:.!?]{1,40}):\s+([\s\S]+)$/;
const MAX_SPEAKER_WORDS = 4;

export function parseVtt(source: string): ParsedTranscript {
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

  if (!lines[0]?.startsWith('WEBVTT')) {
    throw new TranscriptParseError('Not a WebVTT file: it must start with WEBVTT', 1);
  }

  let title: string | null = null;
  const turns: Turn[] = [];

  // A cue is: an optional identifier line, a timing line, then payload lines
  // until a blank line. NOTE and STYLE blocks are skipped whole.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line.length === 0) continue;

    if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
      // Zoom writes the meeting name into the first NOTE. Worth keeping; the
      // caller can still override it.
      const noteText = line.slice(4).trim();
      if (title === null && line.startsWith('NOTE') && noteText.length > 0) {
        title = noteText;
      }
      while (i + 1 < lines.length && (lines[i + 1]?.trim() ?? '').length > 0) i++;
      continue;
    }

    // An identifier line precedes the timing line and has no arrow.
    const timingLine = line.includes('-->') ? line : (lines[++i]?.trim() ?? '');
    const timing = TIMING.exec(timingLine);
    if (!timing) {
      throw new TranscriptParseError(`Expected a cue timing line, got "${timingLine}"`, i + 1);
    }

    const startMs = parseTimestamp(timing[1]!, i + 1);
    const endMs = parseTimestamp(timing[2]!, i + 1);
    if (endMs < startMs) {
      throw new TranscriptParseError(`Cue ends (${endMs}ms) before it starts (${startMs}ms)`, i + 1);
    }

    const payload: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1]?.trim() ?? '').length > 0) {
      payload.push(lines[++i]!.trim());
    }

    const { speaker, text } = splitSpeaker(payload.join(' '));
    // A cue with only a speaker tag and no words carries no evidence.
    if (text.length === 0) continue;

    turns.push({ speaker, startMs, endMs, text });
  }

  if (turns.length === 0) {
    throw new TranscriptParseError('WebVTT file contains no cues');
  }

  return { title, turns };
}

/** `HH:MM:SS.mmm` or `MM:SS.mmm`, per the spec. */
function parseTimestamp(value: string, line: number): number {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new TranscriptParseError(`Malformed timestamp "${value}"`, line);
  }

  const seconds = parts.pop()!.replace(',', '.');
  const secondsValue = Number(seconds);
  const minutes = Number(parts.pop());
  const hours = parts.length > 0 ? Number(parts.pop()) : 0;

  if (!Number.isFinite(secondsValue) || !Number.isFinite(minutes) || !Number.isFinite(hours)) {
    throw new TranscriptParseError(`Malformed timestamp "${value}"`, line);
  }

  return Math.round(((hours * 60 + minutes) * 60 + secondsValue) * 1000);
}

function splitSpeaker(payload: string): { speaker: string | null; text: string } {
  const voice = VOICE_SPAN.exec(payload);
  if (voice) {
    // `<v Ada Lovelace.customer>` — the classes after the name are styling.
    const speaker = voice[1]!.trim().split('.')[0]!.trim();
    return { speaker: speaker.length > 0 ? speaker : null, text: stripTags(voice[2]!).trim() };
  }

  const prefixed = SPEAKER_PREFIX.exec(payload);
  if (prefixed) {
    const label = prefixed[1]!.trim();
    // Guessing wrong in this direction is the cheaper mistake: an unread
    // speaker label costs attribution on one cue, while a misread one turns
    // half a sentence into a person's name.
    if (label.split(/\s+/).length <= MAX_SPEAKER_WORDS) {
      return { speaker: label, text: stripTags(prefixed[2]!).trim() };
    }
  }

  return { speaker: null, text: stripTags(payload).trim() };
}

/** Cue payloads may carry `<i>`, `<c.colour>` and timestamp tags. */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}
