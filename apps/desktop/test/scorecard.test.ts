import { describe, expect, it } from 'vitest';
import { scorecardName } from '../src/main/scorecard';

describe('scorecardName', () => {
  it('sends only a name the product could have made', () => {
    expect(scorecardName('product-demo')).toBe('product-demo');
    expect(scorecardName('../../etc')).toBeNull();
    expect(scorecardName(42)).toBeNull();
  });
});
