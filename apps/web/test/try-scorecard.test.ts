/**
 * Trying a draft scorecard on recent calls.
 *
 * What is pinned: calls are chosen within the window budget and never tried
 * in part; the score comes from the scoring engine, not the detector; and a
 * trial writes nothing but its usage telemetry.
 */
import { describe, expect, it } from 'vitest';
import type { DetectionResult } from '@tesserafy/ai';
import { chooseCalls, tryScorecard, TRY_MAX_CALLS } from '@/lib/try-scorecard';

describe('chooseCalls', () => {
  it('takes the most recent calls that fit, up to three', () => {
    const calls = [1, 2, 3, 4, 5].map((id) => ({ id, segments: 40 }));
    expect(chooseCalls(calls).map((call) => call.id)).toEqual([1, 2, 3]);
    expect(TRY_MAX_CALLS).toBe(3);
  });

  it('passes over a call too long to try whole, and one with no transcript', () => {
    const calls = [
      { id: 'empty', segments: 0 },
      { id: 'three-hours', segments: 2000 },
      { id: 'short', segments: 30 },
    ];
    expect(chooseCalls(calls).map((call) => call.id)).toEqual(['short']);
  });

  it('stops short of the window budget rather than going over it', () => {
    // 600 utterances is 13 windows; two of them would be 26, over 15.
    const calls = [
      { id: 'a', segments: 600 },
      { id: 'b', segments: 600 },
      { id: 'c', segments: 48 },
    ];
    expect(chooseCalls(calls).map((call) => call.id)).toEqual(['a', 'c']);
  });
});

describe('tryScorecard', () => {
  type Segment = { id: string; speaker: string; start_ms: number; end_ms: number; text: string };
  const segments: Record<string, Segment[]> = {
    c1: [
      { id: 's1', speaker: 'customer', start_ms: 0, end_ms: 4000, text: 'Can we pick this up next Tuesday at ten?' },
      { id: 's2', speaker: 'seller', start_ms: 4000, end_ms: 8000, text: 'Tuesday works, I will send the invite.' },
    ],
    c2: [{ id: 's3', speaker: 'customer', start_ms: 0, end_ms: 3000, text: 'Thanks, that was useful.' }],
  };
  const writes: string[] = [];

  function chain(rows: unknown[]): Record<string, unknown> {
    const self: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'limit', 'is']) self[method] = () => self;
    self['eq'] = (column: string, value: string) =>
      column === 'conversation_id' ? chain(segments[value] ?? []) : self;
    self['then'] = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return self;
  }

  const db = {
    from: (table: string) => {
      if (table === 'conversations') {
        return chain([
          { id: 'c1', title: 'Call one', occurred_at: '2026-09-27T10:00:00Z', segments: [{ count: 2 }] },
          { id: 'c2', title: 'Call two', occurred_at: '2026-09-26T10:00:00Z', segments: [{ count: 1 }] },
        ]);
      }
      if (table === 'segments') return chain([]);
      writes.push(table);
      return chain([]);
    },
    rpc: (name: string) => {
      writes.push(name);
      return Promise.resolve({ error: null });
    },
  };

  const detect = (window: readonly { id: string; text: string }[]) => {
    const booked = window.find((segment) => segment.text.includes('next Tuesday'));
    return Promise.resolve({
      events: booked
        ? [
            {
              kind: 'evidence',
              criterionKey: 'next_step_booked',
              confidence: 0.92,
              span: { segmentId: booked.id, startMs: 0, endMs: 4000, quote: 'pick this up next Tuesday at ten' },
            },
          ]
        : [],
      rejected: [],
      model: 'claude-haiku-4-5',
      detector: 't1-detect@test',
    } as unknown as DetectionResult);
  };

  it('scores each call with the engine, from the evidence the detector quoted', async () => {
    const outcome = await tryScorecard(
      db as never,
      'acme',
      {
        name: 'demo',
        criteria: [
          { key: 'agenda_agreed', label: 'Agenda agreed', definition: 'They agree what the call will cover.', weight: 1 },
          { key: 'next_step_booked', label: 'Next step booked', definition: 'A dated next meeting is agreed.', weight: 3 },
        ],
      },
      {} as never,
      detect as never,
    );

    expect(outcome.status).toBe('tried');
    if (outcome.status !== 'tried') return;
    expect(outcome.windows).toBe(2);
    const [one, two] = outcome.calls;
    expect(one!.score).toBe(75);
    expect(one!.criteria.find((criterion) => criterion.key === 'next_step_booked')).toMatchObject({
      status: 'confirmed',
      quote: 'pick this up next Tuesday at ten',
      atMs: 0,
    });
    expect(two!.score).toBe(0);
    expect(two!.criteria.every((criterion) => criterion.status === 'unobserved')).toBe(true);
  });

  it('writes nothing but model usage', () => {
    expect(writes.every((write) => write === 'record_model_usage')).toBe(true);
  });
});
