/**
 * The plans as people read them: what each includes, and what a change of
 * plan changes — up from Free, across to Incognito, and down again.
 */
import { describe, expect, it } from 'vitest';
import { planChanges, planFacts, priceLine, startingPrice, type CatalogRow } from '../lib/plan-catalog';

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  id: 'x', name: 'X', price_usd_cents: null, rank: 0, incognito: false, per_seat: false, max_seats: null,
  calls: 0, extractions: 0, pattern_runs: 0, questions: 0, live_minutes: 0, renews: true, max_call_minutes: null, ...over,
});
const free = row({ id: 'free', name: 'Free', rank: 1, max_seats: 1, calls: 1, extractions: 1, pattern_runs: 0, questions: 5, live_minutes: 15, renews: false, max_call_minutes: 15 });
const pro = row({ id: 'pro', name: 'Pro', rank: 4, price_usd_cents: 1999, per_seat: true, calls: 25, extractions: 25, pattern_runs: 10, questions: 100, live_minutes: 180 });
const incognito = row({ ...pro, id: 'incognito', name: 'Incognito', rank: 5, price_usd_cents: 5999, incognito: true });

describe('planFacts', () => {
  it('says what the Free trial includes, once, how long a call may be, one seat, and that the overlay shows in a share', () => {
    expect(planFacts(free)).toEqual([
      '1 imported call, 1 “Find insights”, 5 questions to Ask, 15 live minutes, once, as a trial',
      'An imported call may be up to 15 minutes long',
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

describe('startingPrice', () => {
  it('is the cheapest priced plan, for Home’s one line on Free', () => {
    expect(startingPrice([incognito, pro])).toBe(1999);
  });
  it('is null when no plan has a price, so the line names none', () => {
    expect(startingPrice([free])).toBeNull();
    expect(startingPrice([])).toBeNull();
  });
});

describe('planChanges', () => {
  it('from Free to Pro: more of everything, teammates, still visible', () => {
    const { direction, lines } = planChanges(free, pro);
    expect(direction).toBe('up');
    expect(lines).toContain('25 imported calls a seat a month, up from 1');
    expect(lines).toContain('10 pattern runs a seat a month, up from 0');
    expect(lines).toContain('Every month, not once');
    expect(lines).toContain('Add teammates: every seat brings its own allowance');
    expect(lines.some((line) => /hidden/.test(line))).toBe(false);
  });
  it('from Pro to Incognito: the overlay hides, nothing else changes', () => {
    expect(planChanges(pro, incognito)).toEqual({ direction: 'up', lines: ['The overlay is hidden from screen sharing'] });
  });
  it('down from Incognito to Free: less, one seat, visible again', () => {
    const { direction, lines } = planChanges(incognito, free);
    expect(direction).toBe('down');
    expect(lines).toContain('1 imported call, once, as a trial, down from 25');
    expect(lines).toContain('No pattern runs');
    expect(lines).toContain('One seat: just you');
    expect(lines).toContain('From your next call, the overlay shows if you share your screen');
  });
});
