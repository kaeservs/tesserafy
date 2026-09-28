/**
 * The console's arithmetic: who counts in the funnel, how far they got and how
 * long it took, spend weeks that include the empty ones, and finding a company.
 */
import { describe, expect, it } from 'vitest';
import {
  adoptionCohort,
  adoptionFunnel,
  adoptionStage,
  findCompanies,
  spendByDetector,
  spendByWeek,
  type AdoptionRow,
} from '../src/console';

function company(name: string, over: Partial<AdoptionRow> = {}): AdoptionRow {
  return {
    companyId: name,
    name,
    plan: 'trial',
    selfServe: false,
    createdAt: '2026-09-01T00:00:00Z',
    closedAt: null,
    firstCallAt: null,
    firstInsightAt: null,
    firstTicketAt: null,
    calls: 0,
    ...over,
  };
}

describe('adoption', () => {
  const rows = [
    company('Acme', { firstCallAt: '2026-09-02T00:00:00Z', firstInsightAt: '2026-09-05T00:00:00Z', firstTicketAt: '2026-09-11T00:00:00Z' }),
    company('Brightloom', { firstCallAt: '2026-09-04T00:00:00Z' }),
    company('Cold', {}),
    company('Tesserafy', { plan: 'internal', firstCallAt: '2026-09-01T00:00:00Z' }),
    company('Synthetic', { closedAt: '2026-09-20T00:00:00Z', firstCallAt: '2026-09-01T00:00:00Z' }),
  ];

  it('counts open customer companies unless asked otherwise', () => {
    expect(adoptionCohort(rows).map((row) => row.name)).toEqual(['Acme', 'Brightloom', 'Cold']);
    expect(adoptionCohort(rows, { includeClosed: true, includeInternal: true })).toHaveLength(5);
  });

  it('says how many reached each step and how long it took them', () => {
    const funnel = adoptionFunnel(adoptionCohort(rows));
    expect(funnel.map((step) => [step.label, step.companies, Math.round(step.share * 100), step.medianDays])).toEqual([
      ['Company created', 3, 100, 0],
      ['First call imported', 2, 67, 2],
      ['First insight', 1, 33, 4],
      ['First ticket', 1, 33, 10],
    ]);
  });

  it('an empty cohort breaks nothing', () => {
    expect(adoptionFunnel([])[1]).toEqual({ label: 'First call imported', companies: 0, share: 0, medianDays: null });
  });

  it('names how far each company got', () => {
    expect(rows.map(adoptionStage)).toEqual(['ticket', 'calls', 'nothing yet', 'calls', 'calls']);
  });
});

describe('spend', () => {
  const rows = [
    { week: '2026-09-21', tier: 't1', model: 'claude-haiku-4-5', detector: 't1-detect', calls: 40, usd: 0.4 },
    { week: '2026-09-21', tier: 't3', model: 'claude-sonnet-5', detector: 't3-extract', calls: 2, usd: 0.1 },
    { week: '2026-09-28', tier: 't1', model: 'claude-haiku-4-5', detector: 't1-detect', calls: 10, usd: 0.1 },
  ];

  it('gives every week in the window, empty ones as zero, oldest first', () => {
    const weeks = spendByWeek(rows, new Date('2026-09-30T12:00:00Z'), 3);
    expect(weeks.map((w) => [w.week, Number(w.usd.toFixed(2)), w.calls])).toEqual([
      ['2026-09-14', 0, 0],
      ['2026-09-21', 0.5, 42],
      ['2026-09-28', 0.1, 10],
    ]);
    expect(weeks[1]!.byTier).toEqual({ t1: 0.4, t3: 0.1 });
  });

  it('totals by what spent it, largest first', () => {
    expect(spendByDetector(rows).map((row) => [row.detector, row.calls, Number(row.usd.toFixed(2))])).toEqual([
      ['t1-detect', 50, 0.5],
      ['t3-extract', 2, 0.1],
    ]);
  });
});

describe('findCompanies', () => {
  const companies = [
    { name: 'acme', plan: 'pro', members: 3, conversations: 40, lastActivity: '2026-09-27', failures24h: 0, spend30dUsd: 2 },
    { name: 'Brightloom', plan: 'basic', members: 1, conversations: 5, lastActivity: null, failures24h: 2, spend30dUsd: 0.2 },
    { name: 'Acme Labs', plan: 'trial', members: 2, conversations: 0, lastActivity: '2026-09-28', failures24h: 0, spend30dUsd: 0 },
  ];

  it('searches names without regard to case', () => {
    expect(findCompanies(companies, 'ACME', 'name').map((c) => c.name)).toEqual(['acme', 'Acme Labs']);
  });

  it('sorts numbers largest first, and reverses when asked', () => {
    expect(findCompanies(companies, '', 'calls').map((c) => c.name)).toEqual(['acme', 'Brightloom', 'Acme Labs']);
    expect(findCompanies(companies, '', 'spend', true).map((c) => c.name)).toEqual(['Acme Labs', 'Brightloom', 'acme']);
  });

  it('puts a company with no activity last by recency', () => {
    expect(findCompanies(companies, '', 'last').map((c) => c.name)).toEqual(['Acme Labs', 'acme', 'Brightloom']);
  });
});
