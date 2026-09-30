/**
 * Criterion health and the team heatmap. Pinned: corrections split into
 * missed and wrong, a criterion is flagged only past both thresholds, and a
 * heatmap cell with one call is empty rather than 0% or 100%.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingCall } from '@/lib/coaching';
import { criterionHealth } from '@/lib/criterion-health';
import { teamHeatmap } from '@/lib/heatmap';

describe('criterionHealth', () => {
  const criteria = [
    { key: 'budget', label: 'Budget' },
    { key: 'pain', label: 'Pain' },
  ];
  const correction = (criterionKey: string, kind: string, createdAt: string) => ({ criterionKey, kind, reason: `r ${createdAt}`, quote: null, createdAt });

  it('counts what the AI missed and what it claimed wrongly, most corrected first', () => {
    const health = criterionHealth(
      criteria,
      [correction('budget', 'evidence', '2026-09-01'), correction('budget', 'contradiction', '2026-09-03'), correction('pain', 'evidence', '2026-09-02')],
      10,
    );
    expect(health.map((h) => [h.key, h.missed, h.wrong, h.attention])).toEqual([
      ['budget', 1, 1, true],
      ['pain', 1, 0, false],
    ]);
    expect(health[0]!.latest[0]!.reason).toBe('r 2026-09-03');
  });

  it('does not flag a criterion corrected twice across many calls', () => {
    const health = criterionHealth(criteria, [correction('budget', 'evidence', '1'), correction('budget', 'evidence', '2')], 40);
    expect(health[0]!.attention).toBe(false);
  });
});

describe('teamHeatmap', () => {
  let n = 0;
  const call = (seller: string, met: string[], over: Partial<CoachingCall> = {}): CoachingCall => {
    n += 1;
    return {
      id: `c${n}`,
      title: `Call ${n}`,
      date: `2026-09-${String(n).padStart(2, '0')}T10:00:00Z`,
      addedBy: seller,
      engagementType: 'discovery',
      outcome: null,
      score: 50,
      criteria: ['budget', 'pain'].map((key) => ({ key, label: key, status: met.includes(key) ? 'confirmed' : 'unobserved' })),
      accountId: null,
      ...over,
    };
  };

  it('gives each seller the share of their calls that established each criterion', () => {
    const map = teamHeatmap([call('ada', ['budget']), call('ada', ['budget', 'pain']), call('grace', ['pain']), call('grace', [], { engagementType: 'renewal' })], 'discovery');
    expect(map.criteria.map((c) => c.key)).toEqual(['budget', 'pain']);
    expect(map.rows.map((row) => [row.seller, row.cells.map((cell) => cell.rate)])).toEqual([
      ['ada', [1, 0.5]],
      ['grace', [null, null]],
    ]);
  });

  it('leaves out calls nobody scored', () => {
    expect(teamHeatmap([call('ada', ['budget'], { score: null })], 'discovery').rows).toEqual([]);
  });
});
