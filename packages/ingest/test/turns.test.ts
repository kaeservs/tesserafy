import { describe, expect, it } from 'vitest';
import { parseTurns } from '../src/parse/turns';
import { TranscriptParseError } from '../src/types';

const VALID = [
  { speaker: 'Grace', startMs: 0, endMs: 2000, text: 'We export it every Friday.' },
  { speaker: 'Ada', startMs: 2000, endMs: 3500, text: 'By hand?' },
];

describe('parseTurns', () => {
  it('accepts a bare array of turns', () => {
    expect(parseTurns(VALID)).toEqual({ title: null, turns: VALID });
  });

  it('accepts an object carrying a title', () => {
    const parsed = parseTurns({ title: 'Acme — discovery call', turns: VALID });

    expect(parsed.title).toBe('Acme — discovery call');
    expect(parsed.turns).toHaveLength(2);
  });

  it('prefers an explicit title over the one in the source', () => {
    expect(parseTurns({ title: 'From file', turns: VALID }, 'From caller').title).toBe(
      'From caller',
    );
  });

  it('normalises a missing or blank speaker to null', () => {
    const parsed = parseTurns([
      { startMs: 0, endMs: 1000, text: 'No speaker key.' },
      { speaker: '  ', startMs: 1000, endMs: 2000, text: 'Blank speaker.' },
    ]);

    expect(parsed.turns.map((t) => t.speaker)).toEqual([null, null]);
  });

  it('trims surrounding whitespace from text', () => {
    expect(parseTurns([{ startMs: 0, endMs: 1, text: '  padded  ' }]).turns[0]?.text).toBe('padded');
  });

  it('rejects a turn with no text', () => {
    expect(() => parseTurns([{ startMs: 0, endMs: 1000, text: '   ' }])).toThrow(/no text/);
  });

  it('rejects non-integer or negative times', () => {
    expect(() => parseTurns([{ startMs: 1.5, endMs: 2000, text: 'x' }])).toThrow(
      TranscriptParseError,
    );
    expect(() => parseTurns([{ startMs: -1, endMs: 2000, text: 'x' }])).toThrow(
      TranscriptParseError,
    );
  });

  it('rejects a turn that ends before it starts', () => {
    expect(() => parseTurns([{ startMs: 5000, endMs: 1000, text: 'x' }])).toThrow(
      /ends .* before it starts/,
    );
  });

  it('rejects turns that are out of order', () => {
    expect(() =>
      parseTurns([
        { startMs: 5000, endMs: 6000, text: 'later' },
        { startMs: 0, endMs: 1000, text: 'earlier' },
      ]),
    ).toThrow(/before turn 1 ended/);
  });

  it('rejects input that is not turns at all', () => {
    expect(() => parseTurns('a transcript')).toThrow(/Expected an array of turns/);
    expect(() => parseTurns([])).toThrow(/no turns/);
    expect(() => parseTurns(['just a string'])).toThrow(/not an object/);
  });
});
