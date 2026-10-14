import { describe, expect, it } from 'vitest';
import { parseVtt } from '../src/parse/vtt';
import { TranscriptParseError } from '../src/types';

const VTT = `WEBVTT

NOTE Acme — discovery call

1
00:00:01.000 --> 00:00:04.500
<v Ada Lovelace>Thanks for making the time.</v>

2
00:01:01.000 --> 00:01:08.500
<v Grace Hopper>Exporting the weekly report takes us
most of Friday afternoon.</v>
`;

describe('parseVtt', () => {
  it('reads cues, speakers and timings', () => {
    const { title, turns } = parseVtt(VTT);

    expect(title).toBe('Acme — discovery call');
    expect(turns).toEqual([
      { speaker: 'Ada Lovelace', startMs: 1000, endMs: 4500, text: 'Thanks for making the time.' },
      {
        speaker: 'Grace Hopper',
        startMs: 61_000,
        endMs: 68_500,
        text: 'Exporting the weekly report takes us most of Friday afternoon.',
      },
    ]);
  });

  it('reads the bare "Name: text" speaker form', () => {
    const source = 'WEBVTT\n\n00:00.000 --> 00:02.000\nGrace Hopper: We ship on Fridays.\n';

    expect(parseVtt(source).turns[0]).toEqual({
      speaker: 'Grace Hopper',
      startMs: 0,
      endMs: 2000,
      text: 'We ship on Fridays.',
    });
  });

  it('does not mistake a sentence containing a colon for a speaker', () => {
    const source = 'WEBVTT\n\n00:00.000 --> 00:02.000\nIt comes down to this: we are late.\n';

    expect(parseVtt(source).turns[0]?.speaker).toBeNull();
  });

  it('keeps cues that no one is attributed to', () => {
    const source = 'WEBVTT\n\n00:00.000 --> 00:02.000\nRoughly forty people use it.\n';

    expect(parseVtt(source).turns[0]).toEqual({
      speaker: null,
      startMs: 0,
      endMs: 2000,
      text: 'Roughly forty people use it.',
    });
  });

  it('strips styling tags and voice-span classes', () => {
    const source =
      'WEBVTT\n\n00:00.000 --> 00:02.000\n<v.first Grace Hopper.customer>We <i>really</i> need this.</v>\n';

    expect(parseVtt(source).turns[0]?.speaker).toBe('Grace Hopper');
    expect(parseVtt(source).turns[0]?.text).toBe('We really need this.');
  });

  it('handles hours and comma decimal separators', () => {
    const source = 'WEBVTT\n\n01:02:03,250 --> 01:02:04,750\nStill here.\n';

    expect(parseVtt(source).turns[0]?.startMs).toBe(3_723_250);
    expect(parseVtt(source).turns[0]?.endMs).toBe(3_724_750);
  });

  it('skips a cue that has a speaker tag but no words', () => {
    const source =
      'WEBVTT\n\n00:00.000 --> 00:01.000\n<v Ada>  </v>\n\n00:01.000 --> 00:02.000\n<v Ada>Right.</v>\n';

    expect(parseVtt(source).turns).toHaveLength(1);
  });

  it('rejects a file that is not WebVTT', () => {
    expect(() => parseVtt('00:00.000 --> 00:02.000\nHello.\n')).toThrow(TranscriptParseError);
  });

  it('rejects a cue whose end precedes its start, naming the line', () => {
    const source = 'WEBVTT\n\n00:05.000 --> 00:02.000\nBackwards.\n';

    expect(() => parseVtt(source)).toThrow(/ends .* before it starts .*line 3/);
  });

  it('rejects a malformed timestamp', () => {
    expect(() => parseVtt('WEBVTT\n\nnot-a-time --> 00:02.000\nHello.\n')).toThrow(
      TranscriptParseError,
    );
  });

  it('rejects a file with no cues', () => {
    expect(() => parseVtt('WEBVTT\n\nNOTE just a comment\n')).toThrow(/no cues/);
  });

  it('refuses a huge line without an arrow at once, and quotes only the start of it', () => {
    // The old timing pattern backtracked quadratically here: 1.1 s at 40,000
    // characters, most of an hour at 2 MB (security review, 2026-10-12).
    const started = Date.now();
    let message = '';
    try {
      parseVtt(`WEBVTT\n\n1\na${' '.repeat(200_000)}b\n`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(Date.now() - started).toBeLessThan(500);
    expect(message).toMatch(/Expected a cue timing line/);
    expect(message.length).toBeLessThan(200);
  });

  it('reads a voice span that never closes in linear time', () => {
    // The old voice-span pattern split `.a.a.a…` into classes every way
    // there is: 24 pairs took 374 ms, each pair doubled it, and 30 held a
    // function for over a minute, before any charge.
    const hostile = [
      `<v${'.a'.repeat(5_000)}!`,
      `<v${' '.repeat(200_000)}x`,
      `<v.a${' '.repeat(200_000)}x`,
    ];
    for (const cue of hostile) {
      const started = Date.now();
      const turns = parseVtt(`WEBVTT\n\n00:00.000 --> 00:01.000\n${cue}\n`).turns;
      expect(Date.now() - started).toBeLessThan(500);
      expect(turns).toHaveLength(1);
    }
  });

  it('still reads a speaker whose name follows several spaces', () => {
    const source = 'WEBVTT\n\n00:00.000 --> 00:01.000\n<v.customer   Ada Lovelace  >Right.</v>\n';

    expect(parseVtt(source).turns[0]?.speaker).toBe('Ada Lovelace');
    expect(parseVtt(source).turns[0]?.text).toBe('Right.');
  });
});
