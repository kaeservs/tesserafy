import { describe, expect, it } from 'vitest';
import { RETENTION_CHOICES, describeRetention, periodLabel } from '../lib/retention';

describe('retention choices', () => {
  it('offers only periods set_retention accepts', () => {
    // The database refuses anything outside a week to ten years. A choice it
    // refused would be a button that always fails.
    for (const days of RETENTION_CHOICES) {
      expect(days).toBeGreaterThanOrEqual(7);
      expect(days).toBeLessThanOrEqual(3650);
    }
  });
});

describe('describeRetention', () => {
  it('says plainly that nothing is deleted when no period is set', () => {
    expect(describeRetention(null)).toBe('Calls are kept until someone deletes them.');
  });

  it('counts from the meeting, in words', () => {
    expect(describeRetention(90)).toBe('Calls are deleted 90 days after they took place.');
    expect(describeRetention(365)).toBe('Calls are deleted 1 year after they took place.');
  });
});

describe('periodLabel', () => {
  it('names whole years as years and anything else in days', () => {
    expect(periodLabel(730)).toBe('2 years');
    expect(periodLabel(30)).toBe('30 days');
    expect(periodLabel(400)).toBe('400 days');
  });
});
