/**
 * The console's account health and "do companies come back" arithmetic.
 * Pure — rows in, answers out — and tested here, as the rest of the console's
 * arithmetic is (./console.ts).
 */

const DAY = 86_400_000;

export interface HealthRow {
  readonly companyId: string;
  readonly name: string;
  readonly plan: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly members: number;
  readonly calls7d: number;
  readonly calls30d: number;
  readonly views7d: number;
  readonly lastCallAt: string | null;
  readonly lastViewAt: string | null;
  readonly failures7d: number;
  readonly usage: readonly { readonly meter: string; readonly used: number; readonly limit: number | null }[];
  readonly periodEnd: string | null;
}

export type HealthFlag = 'not started' | 'quiet' | 'near its limit' | 'failing';

/** A company with no call this long after it was made has not started. */
export const NOT_STARTED_AFTER_DAYS = 7;
/** One whose last call is this old has gone quiet. */
export const QUIET_AFTER_DAYS = 14;
/** A monthly allowance this far used is worth a conversation. */
export const NEAR_LIMIT = 0.8;
/** Recorded failures in a week that mean something is wrong for them. */
export const FAILING_AT = 3;

/**
 * What a person should look at, per company. Several can apply; none means
 * nothing to do. Deliberately few and blunt: a flag that fires for half the
 * list teaches the operator to ignore the list.
 */
export function healthFlags(row: HealthRow, now: Date): HealthFlag[] {
  // A closed company is the record of an erasure: nothing to do.
  if (row.closedAt !== null) return [];
  const days = (iso: string) => (now.getTime() - Date.parse(iso)) / DAY;
  const flags: HealthFlag[] = [];
  if (row.lastCallAt === null) {
    if (days(row.createdAt) >= NOT_STARTED_AFTER_DAYS) flags.push('not started');
  } else if (days(row.lastCallAt) >= QUIET_AFTER_DAYS) {
    flags.push('quiet');
  }
  if (row.usage.some((meter) => meter.limit !== null && meter.limit > 0 && meter.used / meter.limit >= NEAR_LIMIT)) {
    flags.push('near its limit');
  }
  if (row.failures7d >= FAILING_AT) flags.push('failing');
  return flags;
}

/** Companies needing someone first: the most flags, then the longest since a call. */
export function byAttention<T extends HealthRow>(rows: readonly T[], now: Date): (T & { flags: HealthFlag[] })[] {
  return rows
    .map((row) => ({ ...row, flags: healthFlags(row, now) }))
    .sort(
      (a, b) =>
        b.flags.length - a.flags.length ||
        (a.lastCallAt ?? a.createdAt).localeCompare(b.lastCallAt ?? b.createdAt) ||
        a.name.localeCompare(b.name),
    );
}

function mondayOf(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)))
    .toISOString()
    .slice(0, 10);
}

export interface ActiveWeek {
  readonly week: string;
  readonly active: number;
  /** Companies that existed during that week and were not closed before it. */
  readonly existing: number;
}

/** Weekly active companies, oldest week first, every week in the window. */
export function weeklyActive(
  activity: readonly { companyId: string; week: string }[],
  companies: readonly { companyId: string; createdAt: string; closedAt: string | null }[],
  now: Date,
  weeks: number,
): ActiveWeek[] {
  const thisWeek = mondayOf(now.toISOString());
  const out: ActiveWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(Date.parse(thisWeek) - i * 7 * DAY).toISOString().slice(0, 10);
    const start = Date.parse(week);
    out.push({
      week,
      active: new Set(activity.filter((row) => row.week === week).map((row) => row.companyId)).size,
      existing: companies.filter(
        (company) =>
          Date.parse(company.createdAt) < start + 7 * DAY && (company.closedAt === null || Date.parse(company.closedAt) >= start),
      ).length,
    });
  }
  return out;
}

export interface Cohort {
  /** The week the companies in it were created. */
  readonly week: string;
  readonly size: number;
  /** Share active in their 1st, 2nd, … week after starting; null where that week has not come. */
  readonly retained: readonly (number | null)[];
}

/**
 * Do companies keep coming back: of those created in each week, the share
 * active in each week after. The first week is left out, because starting is
 * what created them.
 */
export function cohorts(
  activity: readonly { companyId: string; week: string }[],
  companies: readonly { companyId: string; createdAt: string }[],
  now: Date,
  after: number,
): Cohort[] {
  const thisWeek = Date.parse(mondayOf(now.toISOString()));
  const active = new Set(activity.map((row) => `${row.companyId}|${row.week}`));
  const byWeek = new Map<string, string[]>();
  for (const company of companies) {
    const week = mondayOf(company.createdAt);
    byWeek.set(week, [...(byWeek.get(week) ?? []), company.companyId]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, ids]) => ({
      week,
      size: ids.length,
      retained: Array.from({ length: after }, (_, index) => {
        const later = Date.parse(week) + (index + 1) * 7 * DAY;
        if (later > thisWeek) return null;
        const key = new Date(later).toISOString().slice(0, 10);
        return ids.filter((id) => active.has(`${id}|${key}`)).length / ids.length;
      }),
    }));
}
