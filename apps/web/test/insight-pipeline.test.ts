/**
 * The insight pipeline: each insight counted once, in the stage it is in; the
 * typical time to decide and to ticket; the customers insights draw on.
 */
import { describe, expect, it } from 'vitest';
import { insightPipeline } from '@/lib/insight-pipeline';

describe('insightPipeline', () => {
  const insights = [
    { id: 'a', status: 'proposed', createdAt: '2026-09-01T00:00:00Z', decidedAt: null },
    { id: 'b', status: 'approved', createdAt: '2026-09-01T00:00:00Z', decidedAt: '2026-09-03T00:00:00Z' },
    { id: 'c', status: 'approved', createdAt: '2026-09-01T00:00:00Z', decidedAt: '2026-09-05T00:00:00Z' },
    { id: 'd', status: 'dismissed', createdAt: '2026-09-01T00:00:00Z', decidedAt: '2026-09-02T00:00:00Z' },
  ];
  const tickets = [{ insightId: 'c', createdAt: '2026-09-06T00:00:00Z' }];
  const customersOf = new Map([
    ['a', new Set(['Acme'])],
    ['b', new Set(['Acme', 'Brightloom'])],
    ['c', new Set(['Brightloom'])],
  ]);

  it('counts each insight once, in the stage it is in', () => {
    expect(insightPipeline({ insights, tickets, customersOf })).toMatchObject({ proposed: 1, approved: 1, ticketed: 1, dismissed: 1 });
  });

  it('says how long deciding and ticketing typically take', () => {
    const pipeline = insightPipeline({ insights, tickets, customersOf });
    expect(pipeline.daysToDecide).toBe(2);
    expect(pipeline.daysToTicket).toBe(1);
  });

  it('names the customers insights draw on, most first', () => {
    expect(insightPipeline({ insights, tickets, customersOf }).customers).toEqual([
      { name: 'Acme', insights: 2 },
      { name: 'Brightloom', insights: 2 },
    ]);
  });

  it('says nothing about timing with nothing to time', () => {
    const pipeline = insightPipeline({ insights: [insights[0]!], tickets: [], customersOf: new Map() });
    expect(pipeline).toMatchObject({ daysToDecide: null, daysToTicket: null, customers: [] });
  });
});
