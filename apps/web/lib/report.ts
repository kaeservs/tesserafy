/**
 * The company's calls over time, and by seller.
 *
 * Pure, and fed scorecards the pages already compute: invariant 1 keeps
 * scores out of the database, so a report cannot be a query. It is the same
 * scoring every page uses, grouped by week and by who added the call.
 *
 * A call's week is the week the meeting took place, or the week it was added
 * when nobody said when it took place — the same rule retention uses.
 * Weeks run Monday to Sunday, in UTC.
 *
 * "Scored" means at least one criterion was heard. A call where nothing was
 * heard yet is not a zero: it is a call that has not been scored, and
 * averaging it in as nought would drag every trend down while scoring is
 * still running.
 */

export interface ReportCall {
  /** When the meeting took place, or failing that when it was added. */
  date: string;
  addedBy: string | null;
  /** 0–100, or null when no criterion has been heard yet. */
  score: number | null;
  criteria: { key: string; label: string; status: string }[];
}

export interface Week {
  /** Monday, as YYYY-MM-DD. */
  start: string;
  calls: number;
  scored: number;
  average: number | null;
}

export interface Seller {
  addedBy: string | null;
  calls: number;
  scored: number;
  average: number | null;
  /** The last four weeks against the four before them. */
  recent: number | null;
  previous: number | null;
  /** The criterion least often confirmed on their scored calls; needs three. */
  mostMissed: { label: string; confirmedRate: number } | null;
}

export const WEEKS = 12;
const DAY = 86_400_000;

export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0 = Sunday
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7));
  return new Date(monday).toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function scoresOf(calls: ReportCall[]): number[] {
  return calls.map((c) => c.score).filter((s): s is number => s !== null);
}

export function buildReport(calls: ReportCall[], now: Date = new Date(), weeks = WEEKS) {
  const thisWeek = weekStart(now.toISOString());
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    starts.push(new Date(Date.parse(thisWeek) - i * 7 * DAY).toISOString().slice(0, 10));
  }
  const first = starts[0]!;
  const inWindow = calls.filter((c) => weekStart(c.date) >= first && weekStart(c.date) <= thisWeek);

  const byWeek = new Map<string, ReportCall[]>();
  for (const call of inWindow) {
    const key = weekStart(call.date);
    byWeek.set(key, [...(byWeek.get(key) ?? []), call]);
  }
  const weekRows: Week[] = starts.map((start) => {
    const group = byWeek.get(start) ?? [];
    const scores = scoresOf(group);
    return { start, calls: group.length, scored: scores.length, average: mean(scores) };
  });

  const recentFrom = starts[Math.max(0, weeks - 4)]!;
  const previousFrom = starts[Math.max(0, weeks - 8)]!;

  const bySeller = new Map<string | null, ReportCall[]>();
  for (const call of inWindow) bySeller.set(call.addedBy, [...(bySeller.get(call.addedBy) ?? []), call]);

  const sellers: Seller[] = [...bySeller.entries()].map(([addedBy, group]) => {
    const scored = group.filter((c) => c.score !== null);
    const recent = scoresOf(group.filter((c) => weekStart(c.date) >= recentFrom));
    const previous = scoresOf(
      group.filter((c) => weekStart(c.date) >= previousFrom && weekStart(c.date) < recentFrom),
    );

    let mostMissed: Seller['mostMissed'] = null;
    if (scored.length >= 3) {
      const tally = new Map<string, { label: string; confirmed: number; seen: number }>();
      for (const call of scored) {
        for (const criterion of call.criteria) {
          const t = tally.get(criterion.key) ?? { label: criterion.label, confirmed: 0, seen: 0 };
          t.seen += 1;
          if (criterion.status === 'confirmed') t.confirmed += 1;
          tally.set(criterion.key, t);
        }
      }
      for (const t of tally.values()) {
        const rate = t.confirmed / t.seen;
        if (!mostMissed || rate < mostMissed.confirmedRate) mostMissed = { label: t.label, confirmedRate: rate };
      }
    }

    return {
      addedBy,
      calls: group.length,
      scored: scored.length,
      average: mean(scoresOf(group)),
      recent: mean(recent),
      previous: mean(previous),
      mostMissed,
    };
  });
  sellers.sort((a, b) => b.calls - a.calls);

  return { weeks: weekRows, sellers };
}
