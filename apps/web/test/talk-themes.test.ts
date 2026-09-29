/**
 * Who talked, and themes over time. Pinned: shares are of words, a stretch is
 * one speaker with nobody between, a theme counts calls rather than signals,
 * and a dismissed insight is not a theme.
 */
import { describe, expect, it } from 'vitest';
import { countQuestions, sideShares, speakerKey, talkBySeller, talkStats } from '@/lib/talk';
import { themesOverTime, trendOf } from '@/lib/themes';

const seg = (speaker: string | null, start: number, end: number, text: string) => ({ speaker, start_ms: start, end_ms: end, text });

describe('talkStats', () => {
  it('shares the words out by speaker, most first', () => {
    const stats = talkStats([
      seg('Ada', 0, 4000, 'What does Friday cost you?'),
      seg('Grace', 4000, 20_000, 'Most of the afternoon, every week, for two of us.'),
      seg('Ada', 20_000, 22_000, 'Is that right?'),
    ]);
    expect(stats.words).toBe(18);
    expect(stats.speakers.map((s) => [s.speaker, s.words, s.questions])).toEqual([
      ['Grace', 10, 0],
      ['Ada', 8, 2],
    ]);
    expect(stats.speakers[0]!.share).toBeCloseTo(10 / 18);
  });

  it('takes the longest stretch with nobody else between', () => {
    const stats = talkStats([
      seg('Ada', 0, 10_000, 'one two three'),
      seg('Ada', 10_000, 30_000, 'four five'),
      seg('Grace', 30_000, 31_000, 'yes'),
      seg('Ada', 31_000, 32_000, 'six seven eight nine'),
    ]);
    const ada = stats.speakers.find((s) => s.speaker === 'Ada')!;
    expect([ada.longestWords, ada.longestMs]).toEqual([5, 30_000]);
  });

  it('keeps unattributed lines apart rather than giving them to anyone', () => {
    expect(talkStats([seg(null, 0, 1, 'hello there')]).speakers[0]!.speaker).toBeNull();
  });

  it('counts "?!" and "??" as one question', () => {
    expect(countQuestions('Really?! Why?? And then?')).toBe(3);
  });
});

describe('your side against the customer', () => {
  const ours = new Set([speakerKey('Dana  Whitfield')]);

  it('splits the words once a name is marked, whatever its case or spacing', () => {
    expect(sideShares([{ speaker: 'dana whitfield', words: 30 }, { speaker: 'Priya', words: 70 }], ours)).toEqual({ ours: 0.3, theirs: 0.7 });
  });

  it('has no split until both sides spoke', () => {
    expect(sideShares([{ speaker: 'Priya', words: 70 }], ours)).toBeNull();
    expect(sideShares([{ speaker: 'Dana Whitfield', words: 70 }], ours)).toBeNull();
    expect(sideShares([{ speaker: 'Priya', words: 70 }, { speaker: null, words: 5 }], new Set())).toBeNull();
  });

  it('averages each seller over their calls, not over their words', () => {
    const rows = [
      { conversationId: 'c1', speaker: 'Dana Whitfield', words: 10 },
      { conversationId: 'c1', speaker: 'Priya', words: 90 },
      { conversationId: 'c2', speaker: 'Dana Whitfield', words: 500 },
      { conversationId: 'c2', speaker: 'Priya', words: 500 },
      { conversationId: 'c3', speaker: 'Priya', words: 40 },
    ];
    const bySeller = talkBySeller(rows, ours, new Map([['c1', 'u1'], ['c2', 'u1'], ['c3', 'u1']]));
    expect(bySeller.get('u1')!.calls).toBe(2);
    expect(bySeller.get('u1')!.share).toBeCloseTo(0.3);
  });
});

describe('themesOverTime', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const input = {
    insights: [
      { id: 'i1', title: 'Exports are slow', status: 'approved' },
      { id: 'i2', title: 'Dismissed idea', status: 'dismissed' },
    ],
    evidence: [
      { insightId: 'i1', signalId: 's1' },
      { insightId: 'i1', signalId: 's2' },
      { insightId: 'i1', signalId: 's3' },
      { insightId: 'i2', signalId: 's1' },
    ],
    signals: [
      { id: 's1', conversationId: 'c1', kind: 'problem' },
      { id: 's2', conversationId: 'c1', kind: 'problem' },
      { id: 's3', conversationId: 'c2', kind: 'problem' },
      { id: 's4', conversationId: 'c3', kind: 'feature_request' },
    ],
    callDate: new Map([
      ['c1', '2026-09-29T10:00:00Z'],
      ['c2', '2026-08-18T10:00:00Z'],
      ['c3', '2026-09-22T10:00:00Z'],
    ]),
  };

  it('counts calls a week, not signals, and leaves dismissed insights out', () => {
    const { themes, weeks } = themesOverTime(input, now, 8);
    expect(weeks).toHaveLength(8);
    expect(themes.map((theme) => theme.id)).toEqual(['i1']);
    expect(themes[0]!.calls).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
    expect([themes[0]!.recent, themes[0]!.previous, themes[0]!.trend]).toEqual([1, 1, 'steady']);
  });

  it('counts every signal by kind, grouped or not', () => {
    const { kinds } = themesOverTime(input, now, 2);
    expect(kinds).toEqual({ problem: [0, 2], feature_request: [1, 0] });
  });

  it('calls a theme new when nothing came before it', () => {
    expect([trendOf(2, 0), trendOf(3, 1), trendOf(1, 3), trendOf(0, 0)]).toEqual(['new', 'rising', 'falling', 'steady']);
  });
});
