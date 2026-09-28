import { describe, expect, it } from 'vitest';
import { chooseScorecard, parseScorecards, scorecardName, type ScorecardChoice } from '../src/main/scorecard';

const set = (engagementType: string, own = false): ScorecardChoice => ({
  engagementType,
  version: 1,
  own,
  label: engagementType,
});

describe('chooseScorecard', () => {
  const offered = [set('product-demo', true), set('discovery'), set('renewal')];

  it('keeps the remembered scorecard while it is still offered', () => {
    expect(chooseScorecard(offered, 'renewal', 'discovery')).toBe('renewal');
  });

  it('falls back to the company’s own when the remembered one is gone', () => {
    expect(chooseScorecard(offered, 'retired-set', 'discovery')).toBe('product-demo');
  });

  it('then to the configured default, then to the first offered', () => {
    expect(chooseScorecard([set('discovery'), set('renewal')], null, 'discovery')).toBe('discovery');
    expect(chooseScorecard([set('renewal')], null, 'discovery')).toBe('renewal');
  });

  it('keeps what it had when the list could not be fetched', () => {
    expect(chooseScorecard([], 'renewal', 'discovery')).toBe('renewal');
    expect(chooseScorecard([], null, 'discovery')).toBe('discovery');
  });
});

describe('scorecardName and parseScorecards', () => {
  it('stores only a name the product could have made', () => {
    expect(scorecardName('product-demo')).toBe('product-demo');
    expect(scorecardName('../../etc')).toBeNull();
    expect(scorecardName(42)).toBeNull();
  });

  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parseScorecards({
        sets: [
          { engagementType: 'demo', version: 2, own: true, label: 'Demo' },
          { engagementType: 'Bad Name', version: 1, label: 'x' },
          { engagementType: 'renewal', version: '1', label: 'Renewal' },
        ],
      }),
    ).toEqual([{ engagementType: 'demo', version: 2, own: true, label: 'Demo' }]);
    expect(parseScorecards({ error: 'not signed in' })).toEqual([]);
  });
});
