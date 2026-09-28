import { describe, expect, it } from 'vitest';
import { parseTranscript, transcriptFormat } from '../src/parse/detect';
import { parseText } from '../src/parse/text';
import { parseSrt } from '../src/parse/vtt';
import { TranscriptParseError } from '../src/types';

describe('parseSrt', () => {
  it('reads numbered cues with a comma before the milliseconds', () => {
    const { turns } = parseSrt(`1
00:00:01,000 --> 00:00:04,500
Ada Lovelace: Thanks for making the time.

2
00:01:01,000 --> 00:01:08,500
Grace Hopper: Exporting the weekly report
takes us most of Friday.
`);
    expect(turns).toEqual([
      { speaker: 'Ada Lovelace', startMs: 1000, endMs: 4500, text: 'Thanks for making the time.' },
      { speaker: 'Grace Hopper', startMs: 61_000, endMs: 68_500, text: 'Exporting the weekly report takes us most of Friday.' },
    ]);
  });
});

describe('parseText', () => {
  it('reads a timestamp and a speaker on every line', () => {
    const { turns } = parseText(`[00:00:05] Ada Lovelace: Thanks for making the time.
[00:00:09] Grace Hopper: Happy to. The weekly report takes most of Friday.`);
    expect(turns).toEqual([
      { speaker: 'Ada Lovelace', startMs: 5000, endMs: 9000, text: 'Thanks for making the time.' },
      { speaker: 'Grace Hopper', startMs: 9000, endMs: 9000, text: 'Happy to. The weekly report takes most of Friday.' },
    ]);
  });

  it('reads a speaker with the time in brackets', () => {
    const { turns } = parseText('Ada Lovelace (01:02:03): So what does it cost you?');
    expect(turns[0]).toMatchObject({ speaker: 'Ada Lovelace', startMs: 3_723_000, text: 'So what does it cost you?' });
  });

  it('reads headings with the words underneath, as Otter exports them', () => {
    const { title, turns } = parseText(`Acme discovery call

Ada Lovelace  0:03
Thanks for making the time.
Shall we start with reporting?

Grace Hopper (Acme)  0:12
Yes. It takes us most of Friday.
`);
    expect(title).toBe('Acme discovery call');
    expect(turns).toEqual([
      { speaker: 'Ada Lovelace', startMs: 3000, endMs: 12_000, text: 'Thanks for making the time. Shall we start with reporting?' },
      { speaker: 'Grace Hopper (Acme)', startMs: 12_000, endMs: 12_000, text: 'Yes. It takes us most of Friday.' },
    ]);
  });

  it('gives an unstamped line the last time above it, never one in between', () => {
    const { turns } = parseText(`Transcript
00:00:00
Ada Lovelace: Shall we start?
Grace Hopper: Yes.
00:05:00
Ada Lovelace: What does Friday cost you?`);
    expect(turns.map((turn) => [turn.speaker, turn.startMs, turn.endMs])).toEqual([
      ['Ada Lovelace', 0, 0],
      ['Grace Hopper', 0, 300_000],
      ['Ada Lovelace', 300_000, 300_000],
    ]);
  });

  it('does not take a sentence ending in a time for a speaker', () => {
    const { turns } = parseText(`Ada Lovelace  0:03
We could meet again
on Thursday at 10:30`);
    expect(turns).toEqual([{ speaker: 'Ada Lovelace', startMs: 3000, endMs: 3000, text: 'We could meet again on Thursday at 10:30' }]);
  });

  it('refuses a transcript with no times, because a quote needs one', () => {
    expect(() => parseText('Ada Lovelace: Hello\nGrace Hopper: Hi')).toThrow(TranscriptParseError);
    expect(() => parseText('Ada Lovelace: Hello\nGrace Hopper: Hi')).toThrow(/No timestamps/);
  });

  it('refuses time running backwards, and says where', () => {
    expect(() => parseText('[00:05:00] Ada: Later\n[00:01:00] Grace: Earlier')).toThrow(/backwards.*line 2/);
  });
});

describe('parseTranscript', () => {
  it('goes by contents, except for our own JSON', () => {
    expect(transcriptFormat('call.txt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toBe('vtt');
    expect(transcriptFormat('call.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
    expect(transcriptFormat('call.txt', '[00:00:01] Ada: Hi')).toBe('text');
    expect(transcriptFormat('call.json', '[]')).toBe('json');
    expect(parseTranscript('call.txt', '[00:00:01] Ada: Hi').turns).toHaveLength(1);
  });

  it('reads a file that starts with a byte-order mark, as Windows tools save them', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(transcriptFormat('call.srt', `${bom}1
00:00:01,000 --> 00:00:02,000
Hi`)).toBe('srt');
    expect(parseTranscript('call.srt', `${bom}1
00:00:01,000 --> 00:00:02,000
Hi`).turns[0]!.text).toBe('Hi');
    expect(parseTranscript('call.txt', `${bom}[00:00:01] Ada: Hi`).turns[0]!.speaker).toBe('Ada');
  });
});
