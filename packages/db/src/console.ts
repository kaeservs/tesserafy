/**
 * The operator console's arithmetic: the adoption funnel, spend by week, and
 * finding a company. Pure — rows in, answers out — so it is tested here rather
 * than in a console that has no test runner.
 */

const DAY = 86_400_000;

export interface AdoptionRow {
  readonly companyId: string;
  readonly name: string;
  readonly plan: string;
  readonly selfServe: boolean;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly firstCallAt: string | null;
  readonly firstInsightAt: string | null;
  readonly firstTicketAt: string | null;
  readonly calls: number;
}

export interface FunnelStep {
  readonly label: string;
  readonly companies: number;
  /** Share of the companies that started. */
  readonly share: number;
  /** Median days from the company being created, among those that got here. */
  readonly medianDays: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Which companies count: by default the open ones that are customers. Closed
 * companies are the record of what was erased (and, so far, every synthetic
 * test company), and 'internal' is Tesserafy's own.
 */
export function adoptionCohort(
  rows: readonly AdoptionRow[],
  options: { includeClosed?: boolean; includeInternal?: boolean } = {},
): AdoptionRow[] {
  return rows.filter(
    (row) => (options.includeClosed || row.closedAt === null) && (options.includeInternal || row.plan !== 'internal'),
  );
}

/** Company → first call → first insight → first ticket. */
export function adoptionFunnel(cohort: readonly AdoptionRow[]): FunnelStep[] {
  const steps: { label: string; at: (row: AdoptionRow) => string | null }[] = [
    { label: 'Company created', at: (row) => row.createdAt },
    { label: 'First call imported', at: (row) => row.firstCallAt },
    { label: 'First insight', at: (row) => row.firstInsightAt },
    { label: 'First ticket', at: (row) => row.firstTicketAt },
  ];
  const started = cohort.length;
  return steps.map(({ label, at }) => {
    const reached = cohort.filter((row) => at(row) !== null);
    return {
      label,
      companies: reached.length,
      share: started === 0 ? 0 : reached.length / started,
      medianDays: median(reached.map((row) => Math.max(0, (Date.parse(at(row)!) - Date.parse(row.createdAt)) / DAY))),
    };
  });
}

/** Where a company has got to, in a word. */
export function adoptionStage(row: AdoptionRow): string {
  if (row.firstTicketAt) return 'ticket';
  if (row.firstInsightAt) return 'insight';
  if (row.firstCallAt) return 'calls';
  return 'nothing yet';
}

export interface SpendRow {
  readonly week: string;
  readonly tier: string;
  readonly model: string;
  readonly detector: string;
  readonly calls: number;
  readonly usd: number;
}

export interface SpendWeek {
  /** Monday, YYYY-MM-DD. */
  readonly week: string;
  readonly usd: number;
  readonly calls: number;
  readonly byTier: Readonly<Record<string, number>>;
}

/**
 * One row per week for the last `weeks`, oldest first, including weeks with
 * nothing spent — a gap in a chart that is really a zero reads like missing
 * data.
 */
export function spendByWeek(rows: readonly SpendRow[], now: Date, weeks: number): SpendWeek[] {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const out: SpendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(monday.getTime() - i * 7 * DAY).toISOString().slice(0, 10);
    const these = rows.filter((row) => row.week === week);
    const byTier: Record<string, number> = {};
    for (const row of these) byTier[row.tier] = (byTier[row.tier] ?? 0) + row.usd;
    out.push({
      week,
      usd: these.reduce((sum, row) => sum + row.usd, 0),
      calls: these.reduce((sum, row) => sum + row.calls, 0),
      byTier,
    });
  }
  return out;
}

/** Spend over the whole window by what spent it, largest first. */
export function spendByDetector(rows: readonly SpendRow[]): { detector: string; model: string; calls: number; usd: number }[] {
  const totals = new Map<string, { detector: string; model: string; calls: number; usd: number }>();
  for (const row of rows) {
    const key = `${row.detector}|${row.model}`;
    const seen = totals.get(key) ?? { detector: row.detector, model: row.model, calls: 0, usd: 0 };
    seen.calls += row.calls;
    seen.usd += row.usd;
    totals.set(key, seen);
  }
  return [...totals.values()].sort((a, b) => b.usd - a.usd);
}

/**
 * What a detector is, as a product feature: the console's spend reads by what
 * people use (the overlay's help, Ask, follow-up emails), not by prompt
 * version. A detector's version and a `+guided` suffix do not change its
 * feature; anything not listed is "Other", never dropped.
 */
const FEATURE_OF: readonly (readonly [RegExp, string])[] = [
  [/^t1-detect/, 'Scoring, live and imported'],
  [/^t2-suggest/, 'Live suggestions'],
  [/^t2-assist/, 'Overlay help: Assist, What to say, Follow-ups, Recap, Ask'],
  [/^ask-calls/, 'Ask your calls'],
  [/^t3-follow-up/, 'Follow-up emails'],
  [/^t3-actions/, 'Action items'],
  [/^t3-extract/, 'Find insights in a call'],
  [/^t3-synthesise/, 'Look for patterns'],
  [/prep|brief/, 'Call prep briefs'],
];

export function featureOf(detector: string): string {
  return FEATURE_OF.find(([pattern]) => pattern.test(detector))?.[1] ?? 'Other';
}

/** Spend over the whole window by product feature, largest first. */
export function spendByFeature(rows: readonly SpendRow[]): { feature: string; calls: number; usd: number }[] {
  const totals = new Map<string, { feature: string; calls: number; usd: number }>();
  for (const row of rows) {
    const feature = featureOf(row.detector);
    const seen = totals.get(feature) ?? { feature, calls: 0, usd: 0 };
    seen.calls += row.calls;
    seen.usd += row.usd;
    totals.set(feature, seen);
  }
  return [...totals.values()].sort((a, b) => b.usd - a.usd);
}

export const COMPANY_SORTS = ['name', 'plan', 'people', 'calls', 'last', 'failures', 'spend'] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export interface SortableCompany {
  readonly name: string;
  readonly plan: string;
  readonly members: number;
  readonly conversations: number;
  readonly lastActivity: string | null;
  readonly failures24h: number;
  readonly spend30dUsd: number;
}

/**
 * Companies matching a search, in the order asked. Numbers sort largest first
 * and names A to Z unless reversed; a company with no activity sorts as the
 * oldest.
 */
export function findCompanies<T extends SortableCompany>(
  companies: readonly T[],
  query: string,
  sort: CompanySort,
  reverse = false,
): T[] {
  const q = query.trim().toLowerCase();
  const matched = q ? companies.filter((company) => company.name.toLowerCase().includes(q)) : [...companies];
  const key: Record<CompanySort, (a: T, b: T) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    plan: (a, b) => a.plan.localeCompare(b.plan) || a.name.localeCompare(b.name),
    people: (a, b) => b.members - a.members,
    calls: (a, b) => b.conversations - a.conversations,
    last: (a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''),
    failures: (a, b) => b.failures24h - a.failures24h,
    spend: (a, b) => b.spend30dUsd - a.spend30dUsd,
  };
  const sorted = matched.sort((a, b) => key[sort](a, b) || a.name.localeCompare(b.name));
  return reverse ? sorted.reverse() : sorted;
}
