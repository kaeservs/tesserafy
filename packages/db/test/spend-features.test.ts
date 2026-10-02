/** The console's spend by product feature: every detector version lands on its feature, nothing is dropped. */
import { describe, expect, it } from 'vitest';
import { featureOf, spendByFeature, type SpendRow } from '../src/console';

const row = (detector: string, usd: number, calls = 1): SpendRow => ({ week: '2026-09-28', tier: 't2', model: 'claude-sonnet-5', detector, calls, usd });

describe('spend by feature', () => {
  it('names each detector by what people use, whatever its version or guidance', () => {
    expect(featureOf('t2-assist@2026-10-09')).toBe('Overlay help: Assist, What to say, Follow-ups, Recap, Ask');
    expect(featureOf('ask-calls@2026-10-11')).toBe('Ask your calls');
    expect(featureOf('t3-follow-up@2026-10-12')).toBe('Follow-up emails');
    expect(featureOf('t1-detect@2026-09-19+guided')).toBe('Scoring, live and imported');
    expect(featureOf('something-new@1')).toBe('Other');
  });

  it('adds up across versions, largest first', () => {
    expect(
      spendByFeature([row('t3-extract@2026-09-17', 1), row('t3-extract@2026-09-19', 2, 3), row('ask-calls@2026-10-11', 5)]),
    ).toEqual([
      { feature: 'Ask your calls', calls: 1, usd: 5 },
      { feature: 'Find insights in a call', calls: 4, usd: 3 },
    ]);
  });
});
