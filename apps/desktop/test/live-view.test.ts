/**
 * Live captions and talk time: the last few lines with who said them, the
 * microphone's guess hidden while the customer is talking (it is their own
 * words again), and a nudge only when the seller has really been doing the
 * talking — after the opening, on enough words, and not again for a while.
 */
import { describe, expect, it } from 'vitest';
import { Captions, ECHO_QUIET_MS, MOST_CHARACTERS } from '../src/renderer/captions';
import { ENOUGH_WORDS, QUIET_AFTER_NUDGE_MS, SETTLED_MS, TalkMeter } from '../src/renderer/talk-time';

describe('Captions', () => {
  it('shows finished lines, then what is being said now, each side named', () => {
    const captions = new Captions(3);
    captions.heard('me', 'utterance', 'How long does month-end take?', 0);
    captions.heard('them', 'interim', 'Two full', 1_000);
    expect(captions.lines(1_000)).toEqual([
      { side: 'me', text: 'How long does month-end take?', live: false },
      { side: 'them', text: 'Two full', live: true },
    ]);
    captions.heard('them', 'utterance', 'Two full days, every month.', 2_000);
    expect(captions.lines(2_000).map((line) => [line.side, line.live])).toEqual([
      ['me', false],
      ['them', false],
    ]);
  });

  it('keeps only the last few, and the newest words of a long line', () => {
    const captions = new Captions(2);
    for (const n of [1, 2, 3]) captions.heard('them', 'utterance', `Line ${n}`, n);
    expect(captions.lines(10).map((line) => line.text)).toEqual(['Line 2', 'Line 3']);
    captions.heard('them', 'interim', 'x'.repeat(400) + ' the end', 11);
    const long = captions.lines(11).at(-1)!.text;
    expect(long.length).toBe(MOST_CHARACTERS);
    expect(long.endsWith('the end')).toBe(true);
  });

  it('hides the microphone’s guess while the customer is talking, and shows it once they stop', () => {
    const captions = new Captions(3);
    captions.heard('them', 'interim', 'We need it by December', 10_000);
    captions.heard('me', 'interim', 'we need it by December', 10_200);
    expect(captions.lines(10_300).map((line) => line.side)).toEqual(['them']);
    captions.heard('them', 'utterance', 'We need it by December.', 10_400);
    captions.heard('me', 'interim', 'Then let us plan back from that', 10_400 + ECHO_QUIET_MS + 1);
    expect(captions.lines(10_400 + ECHO_QUIET_MS + 1).map((line) => line.side)).toEqual(['them', 'me']);
  });
});

const sentence = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('TalkMeter', () => {
  it('counts each side’s share of the words', () => {
    const meter = new TalkMeter(0);
    meter.heard('me', sentence(30), 1_000);
    meter.heard('them', sentence(70), 2_000);
    expect(meter.shares()).toEqual({ me: 0.3, them: 0.7, words: 100 });
  });

  it('nudges a seller doing most of the talking, but not in the opening, on a few words, or twice in a row', () => {
    const meter = new TalkMeter(0);
    meter.heard('me', sentence(ENOUGH_WORDS), 60_000);
    meter.heard('them', sentence(20), 90_000);
    expect(meter.nudge(60_000)).toBeNull();
    expect(meter.nudge(SETTLED_MS)).toMatch(/^You’ve done 86% of the talking/);
    expect(meter.nudge(SETTLED_MS + 1_000)).toBeNull();
    meter.heard('me', sentence(ENOUGH_WORDS), SETTLED_MS + QUIET_AFTER_NUDGE_MS);
    expect(meter.nudge(SETTLED_MS + QUIET_AFTER_NUDGE_MS)).not.toBeNull();
  });

  it('leaves a seller alone who lets the customer talk', () => {
    const meter = new TalkMeter(0);
    meter.heard('me', sentence(60), 200_000);
    meter.heard('them', sentence(140), 210_000);
    expect(meter.nudge(SETTLED_MS + 30_000)).toBeNull();
  });
});
