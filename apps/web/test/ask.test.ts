/**
 * What a question to Ask may be narrowed by: an account id that is an id,
 * and a period from the list. Anything else is ignored, never passed on.
 */
import { describe, expect, it } from 'vitest';
import { askFilters } from '@/lib/ask';

describe('Ask filters', () => {
  it('takes an account id and a period it offers', () => {
    expect(askFilters({ accountId: '00000000-0000-4000-8000-0000000000c1', days: 30 })).toEqual({
      accountId: '00000000-0000-4000-8000-0000000000c1',
      days: 30,
    });
  });

  it('ignores anything else', () => {
    expect(askFilters({ accountId: "x' or 1=1", days: 31 })).toEqual({ accountId: null, days: null });
    expect(askFilters({ accountId: 7, days: '30' })).toEqual({ accountId: null, days: null });
    expect(askFilters({})).toEqual({ accountId: null, days: null });
  });
});
