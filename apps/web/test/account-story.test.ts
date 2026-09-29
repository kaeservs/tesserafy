/**
 * A customer's story. Pinned: a criterion confirmed on any call with them is
 * established and not asked again, unscored calls say nothing, each scorecard
 * is its own list, and your own people are not listed as theirs.
 */
import { describe, expect, it } from 'vitest';
import { customerCoverage, scoreTrend, theirPeople, type StoryCall } from '@/lib/account-story';

const criteria = (met: string[]) =>
  ['budget', 'pain', 'timeline'].map((key) => ({ key, label: key[0]!.toUpperCase() + key.slice(1), status: met.includes(key) ? 'confirmed' : 'unobserved' }));
const call = (id: string, date: string, met: string[], over: Partial<StoryCall> = {}): StoryCall => ({
  id,
  title: `Call ${id}`,
  date: `${date}T10:00:00Z`,
  score: 50,
  engagementType: 'discovery',
  criteria: criteria(met),
  ...over,
});

describe('customerCoverage', () => {
  it('counts a criterion established once any call confirms it, naming the first', () => {
    const [coverage] = customerCoverage([call('b', '2026-09-20', ['timeline']), call('a', '2026-09-01', ['pain'])]);
    expect(coverage!.established.map((c) => [c.key, c.callId])).toEqual([
      ['pain', 'a'],
      ['timeline', 'b'],
    ]);
    expect(coverage!.stillToFindOut).toEqual([{ key: 'budget', label: 'Budget' }]);
  });

  it('ignores calls nobody scored, and keeps each scorecard apart', () => {
    const coverage = customerCoverage([
      call('a', '2026-09-01', ['pain', 'budget', 'timeline'], { score: null }),
      call('b', '2026-09-02', [], { engagementType: 'renewal' }),
    ]);
    expect(coverage.map((c) => [c.engagementType, c.stillToFindOut.length])).toEqual([['renewal', 3]]);
  });
});

describe('scoreTrend', () => {
  it('lists scored calls oldest first', () => {
    expect(scoreTrend([call('b', '2026-09-20', [], { score: 80 }), call('x', '2026-09-10', [], { score: null }), call('a', '2026-09-01', [], { score: 40 })]).map((p) => [p.id, p.score])).toEqual([
      ['a', 40],
      ['b', 80],
    ]);
  });
});

describe('theirPeople', () => {
  it('lists everyone who is not one of yours, most calls first', () => {
    const people = theirPeople(
      [
        { conversationId: 'a', speaker: 'Tom', words: 100 },
        { conversationId: 'b', speaker: 'Tom', words: 50 },
        { conversationId: 'a', speaker: 'Priya', words: 400 },
        { conversationId: 'a', speaker: 'Maya', words: 300 },
        { conversationId: 'a', speaker: null, words: 20 },
      ],
      (name) => name === 'Maya',
    );
    expect(people).toEqual([
      { name: 'Tom', calls: 2, words: 150 },
      { name: 'Priya', calls: 1, words: 400 },
    ]);
  });
});
