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
  it('says what the plan includes, and what to do on Basic', () => {
    expect(describeRefusal(refusal())).toBe(
      'Your Basic plan includes 10 imported calls a month, and they have all been used. An owner can upgrade under Settings → Plan, or it resets on 25 October.',
    );
  });

  it('on Pro there is nothing to upgrade to, only a date', () => {
    expect(describeRefusal(refusal({ plan: 'pro', limit: 25, meter: 'extractions' }))).toBe(
      'Your Pro plan includes 25 “Find insights in this call” runs a month, and they have all been used. It resets on 25 October.',
    );
  });

  it('on the trial it points at choosing a plan', () => {
    expect(describeRefusal(refusal({ plan: 'trial', limit: 1, meter: 'pattern_runs' }))).toBe(
      'Your trial includes 1 “Look for patterns” run, and they have all been used. An owner can choose Basic or Pro under Settings → Plan.',
    );
  });

  it('counts live time in minutes, as the plan is sold', () => {
    expect(describeRefusal(refusal({ meter: 'live_seconds', limit: 3600 }))).toContain('includes 60 live minutes');
  });

  it('with no plan at all, says so rather than quoting a limit of zero', () => {
    expect(describeRefusal(refusal({ plan: 'none', limit: 0 }))).toBe(
      'Your company has no plan at the moment. An owner can choose one under Settings → Plan.',
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

  it('never more than thirty, so one bad clock does not empty the month', () => {
    expect(liveSeconds([{ startMs: 0, endMs: 3_600_000 }])).toBe(30);
  });

  it('charges the floor for an empty or broken window', () => {
    expect(liveSeconds([])).toBe(5);
    expect(liveSeconds([{ startMs: Number.NaN, endMs: 1 }])).toBe(5);
  });
});
