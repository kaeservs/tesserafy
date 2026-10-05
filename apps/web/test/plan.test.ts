import { describe, expect, it } from 'vitest';
import { describeRefusal, liveSeconds } from '../lib/plan';

const refusal = (overrides: Partial<Parameters<typeof describeRefusal>[0]> = {}) => ({
  allowed: false as const,
  meter: 'calls' as const,
  used: 10,
  limit: 10,
  plan: 'basic',
  resetsAt: '2026-10-25T00:00:00Z',
  ...overrides,
});

describe('describeRefusal', () => {
  it('says what the plan includes, and what to do on Starter', () => {
    expect(describeRefusal(refusal())).toBe(
      'Your Starter plan includes 10 imported calls a month, and they have all been used. An owner can upgrade or add seats on Profile → Your membership, or it resets on 25 October.',
    );
  });

  it('on Pro the way to more is seats, or the date', () => {
    expect(describeRefusal(refusal({ plan: 'pro', limit: 25, meter: 'extractions' }))).toBe(
      'Your Pro plan includes 25 “Find insights” or call preps a month, and they have all been used. An owner can add seats on Profile → Your membership, or it resets on 25 October.',
    );
  });

  it('on Free it points at choosing a plan', () => {
    expect(describeRefusal(refusal({ plan: 'free', limit: 2 }))).toBe(
      'Your Free plan includes 2 imported calls a month, and they have all been used. An owner can choose Starter, Pro or Incognito on Profile → Your membership.',
    );
  });

  it('says plainly what a plan does not include at all', () => {
    expect(describeRefusal(refusal({ plan: 'free', limit: 0, meter: 'pattern_runs' }))).toBe(
      '“Look for patterns” runs are not on your Free plan. An owner can choose Starter, Pro or Incognito on Profile → Your membership.',
    );
  });

  it('counts live time in minutes, as the plan is sold', () => {
    expect(describeRefusal(refusal({ meter: 'live_seconds', limit: 3600 }))).toContain('includes 60 live minutes');
  });

  it('with no plan at all, says so rather than quoting a limit of zero', () => {
    expect(describeRefusal(refusal({ plan: 'none', limit: 0 }))).toBe(
      'Your company has no plan at the moment. An owner can choose one on Profile → Your membership.',
    );
  });

  it('when the allowance could not be read, says nothing ran', () => {
    expect(describeRefusal(refusal({ error: 'timeout' }))).toContain('nothing was run');
  });
});

describe('liveSeconds', () => {
  it('charges the utterance that was just said', () => {
    expect(liveSeconds([{ startMs: 0, endMs: 3000 }, { startMs: 10_000, endMs: 22_000 }])).toBe(12);
  });

  it('never less than five seconds, so reporting instant speech is not free', () => {
    expect(liveSeconds([{ startMs: 1000, endMs: 1000 }])).toBe(5);
    expect(liveSeconds([{ startMs: 5000, endMs: 1000 }])).toBe(5);
  });

  it('never more than a minute — the most the database takes in one charge — so a silence or one bad clock does not empty the month', () => {
    expect(liveSeconds([{ startMs: 0, endMs: 3_600_000 }])).toBe(60);
  });

  it('charges the call’s time since the last charge, the seller’s lines in between included', () => {
    // The customer finished at 40 s, the seller spoke, the customer finished again at 95 s.
    expect(liveSeconds([{ startMs: 95_000, endMs: 95_000 }], 40_000)).toBe(55);
    // An hour of conversation, one charge every 25 s, is an hour charged.
    const charges = Array.from({ length: 144 }, (_, i) => liveSeconds([{ startMs: (i + 1) * 25_000, endMs: (i + 1) * 25_000 }], i * 25_000));
    expect(charges.reduce((sum, s) => sum + s, 0)).toBe(3_600);
  });

  it('falls back to the line itself when the caller sends no charge point, or a nonsense one', () => {
    expect(liveSeconds([{ startMs: 1000, endMs: 13_000 }], undefined)).toBe(12);
    expect(liveSeconds([{ startMs: 1000, endMs: 13_000 }], 'yesterday')).toBe(12);
    expect(liveSeconds([{ startMs: 1000, endMs: 13_000 }], 50_000)).toBe(12);
  });

  it('charges the floor for an empty or broken window', () => {
    expect(liveSeconds([])).toBe(5);
    expect(liveSeconds([{ startMs: Number.NaN, endMs: 1 }])).toBe(5);
  });
});
