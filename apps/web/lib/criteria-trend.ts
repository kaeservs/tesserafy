import type { CoachingCall } from './coaching';
import { weekStart } from './report';

/**
 * Criteria over time: for each criterion, the share of scored calls that met
 * it, week by week — is "Budget indicated" improving since coaching started?
 *
 * Per scorecard, because criteria differ between them; pooled across versions
 * by key, as coaching pools them. A week with no scored call carrying the
 * criterion has no rate rather than a zero: nothing happened is not nobody
 * managed it.
 */

const DAY = 86_400_000;

export interface TrendPoint {
  readonly week: string;
  readonly calls: number;
  readonly rate: number | null;
}

export interface CriterionTrend {
  readonly engagementType: string;
  readonly key: string;
  readonly label: string;
  readonly points: readonly TrendPoint[];
  /** The last four weeks' rate against the four before, in points; null without both. */
  readonly change: number | null;
}

function share(calls: readonly CoachingCall[], key: string): { calls: number; rate: number | null } {
  const carrying = calls.filter((call) => call.criteria.some((criterion) => criterion.key === key));
  if (carrying.length === 0) return { calls: 0, rate: null };
  const met = carrying.filter((call) => call.criteria.some((criterion) => criterion.key === key && criterion.status === 'confirmed'));
  return { calls: carrying.length, rate: met.length / carrying.length };
}

export function criteriaTrend(calls: readonly CoachingCall[], now: Date, weeks: number): CriterionTrend[] {
  const thisWeek = weekStart(now.toISOString());
  const starts = Array.from({ length: weeks }, (_, index) =>
    new Date(Date.parse(thisWeek) - (weeks - 1 - index) * 7 * DAY).toISOString().slice(0, 10),
  );
  const first = starts[0]!;
  const scored = calls.filter((call) => call.score !== null && weekStart(call.date) >= first && weekStart(call.date) <= thisWeek);

  const labels = new Map<string, { engagementType: string; key: string; label: string; date: string }>();
  for (const call of scored) {
    for (const criterion of call.criteria) {
      const id = `${call.engagementType}|${criterion.key}`;
      const seen = labels.get(id);
      if (!seen || call.date > seen.date) {
        labels.set(id, { engagementType: call.engagementType, key: criterion.key, label: criterion.label, date: call.date });
      }
    }
  }

  const recentFrom = starts[Math.max(0, weeks - 4)]!;
  const previousFrom = starts[Math.max(0, weeks - 8)]!;
  return [...labels.values()]
    .map(({ engagementType, key, label }) => {
      const mine = scored.filter((call) => call.engagementType === engagementType);
      const points = starts.map((week) => ({ week, ...share(mine.filter((call) => weekStart(call.date) === week), key) }));
      const recent = share(mine.filter((call) => weekStart(call.date) >= recentFrom), key).rate;
      const previous =
        weeks >= 8 ? share(mine.filter((call) => weekStart(call.date) >= previousFrom && weekStart(call.date) < recentFrom), key).rate : null;
      return {
        engagementType,
        key,
        label,
        points,
        change: recent !== null && previous !== null ? Math.round((recent - previous) * 100) : null,
      };
    })
    .sort((a, b) => a.engagementType.localeCompare(b.engagementType) || a.label.localeCompare(b.label));
}
