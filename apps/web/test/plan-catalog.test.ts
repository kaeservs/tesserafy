/**
 * The plans as people read them: what each includes, and what a change of
 * plan changes — up from Free, across to Incognito, and down again.
 */
import { describe, expect, it } from 'vitest';
import { planChanges, planFacts, priceLine, type CatalogRow } from '../lib/plan-catalog';

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  id: 'x', name: 'X', price_usd_cents: null, rank: 0, incognito: false, per_seat: false, max_seats: null,
  calls: 0, extractions: 0, pattern_runs: 0, questions: 0, live_minutes: 0, ...over,
});
const free = row({ id: 'free', name: 'Free', rank: 1, max_seats: 1, calls: 2, extractions: 1, pattern_runs: 0, questions: 5, live_minutes: 10 });
const pro = row({ id: 'pro', name: 'Pro', rank: 4, price_usd_cents: 1999, per_seat: true, calls: 25, extractions: 25, pattern_runs: 10, questions: 100, live_minutes: 180 });
const incognito = row({ ...pro, id: 'incognito', name: 'Incognito', rank: 5, price_usd_cents: 5999, incognito: true });

describe('planFacts', () => {
  it('says what Free includes, that it is one seat, and that the overlay shows in a share', () => {
    expect(planFacts(free)).toEqual([
      '2 imported calls, 1 “Find insights”, 5 questions to Ask, 10 live minutes a month',
      'Just you: one seat',
      'The overlay shows if you share your screen',
    ]);
    expect(priceLine(free)).toBe('Free');
  });
  it('and Incognito, per seat, hidden', () => {
    expect(planFacts(incognito)[0]).toMatch(/a seat a month$/);
    expect(planFacts(incognito)).toContain('The overlay is hidden from screen sharing');
    expect(priceLine(incognito)).toBe('$59.99 a seat a month');
  });
});

describe('planChanges', () => {
  it('from Free to Pro: more of everything, teammates, still visible', () => {
    const { direction, lines } = planChanges(free, pro);
    expect(direction).toBe('up');
    expect(lines).toContain('25 imported calls a seat a month, up from 2');
    expect(lines).toContain('10 pattern runs a seat a month, up from 0');
    expect(lines).toContain('Add teammates: every seat brings its own allowance');
    expect(lines.some((line) => /hidden/.test(line))).toBe(false);
  });
  it('from Pro to Incognito: the overlay hides, nothing else changes', () => {
    expect(planChanges(pro, incognito)).toEqual({ direction: 'up', lines: ['The overlay is hidden from screen sharing'] });
  });
  it('down from Incognito to Free: less, one seat, visible again', () => {
    const { direction, lines } = planChanges(incognito, free);
    expect(direction).toBe('down');
    expect(lines).toContain('2 imported calls a month, down from 25');
    expect(lines).toContain('No pattern runs');
    expect(lines).toContain('One seat: just you');
    expect(lines).toContain('From your next call, the overlay shows if you share your screen');
  });
});
