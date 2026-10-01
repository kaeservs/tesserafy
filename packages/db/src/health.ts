/**
 * What counts as "needs a person" among recorded failures, once.
 *
 * `pnpm health` — the scheduled alarm — and the operator console's Failures
 * page both read `system_failures`. If each had its own idea of which failures
 * matter, the page could show green while the alarm fired, or the reverse,
 * and the operator would learn to trust neither. So the judgement lives here
 * and both use it.
 *
 * The judgement is deliberately narrow. A model that was overloaded is
 * weather. A caller that sent nonsense is not our outage. A request we built
 * wrong, or our own database refusing us, is a bug that is live right now.
 * Two false alarms teach an operator to ignore the alarm.
 *
 * Pure: rows in, groups out. No database, no clock but the one passed in.
 */

/** The kinds that mean somebody must act today. */
export const ACTIONABLE_KINDS: ReadonlySet<string> = new Set(['model_rejected', 'database', 'billing']);

/**
 * Below this, an actionable failure is reported but does not raise the alarm.
 * One rejected request can be a fluke — a truncated deploy, a single bad
 * payload. Two inside the window is a pattern.
 */
export const ALARM_AT = 2;

export interface FailureRow {
  readonly source: string;
  readonly kind: string;
  readonly tier: string | null;
  readonly model: string | null;
  readonly status: number | null;
  readonly message: string;
  readonly created_at: string;
  readonly company_id?: string | null;
}

export interface FailureGroup {
  readonly kind: string;
  readonly source: string;
  readonly status: number | null;
  readonly tier: string | null;
  readonly model: string | null;
  readonly count: number;
  /** The most recent occurrence. */
  readonly last: string;
  readonly first: string;
  /** The most recent message, first line only. */
  readonly message: string;
  readonly needsAPerson: boolean;
  /** Companies it happened to, most recent first; empty when none was known. */
  readonly companyIds: readonly string[];
}

/**
 * Failures grouped by what broke and where — twenty rows of the same 400 are
 * one problem — actionable first, then the most frequent.
 */
export function groupFailures(rows: readonly FailureRow[]): FailureGroup[] {
  const groups = new Map<string, FailureRow[]>();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.source}\u0000${row.status ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const latest = sorted[0]!;
      return {
        kind: latest.kind,
        source: latest.source,
        status: latest.status,
        tier: latest.tier,
        model: latest.model,
        count: sorted.length,
        last: latest.created_at,
        first: sorted.at(-1)!.created_at,
        message: latest.message.split('\n')[0]!.slice(0, 240),
        needsAPerson: ACTIONABLE_KINDS.has(latest.kind),
        companyIds: [...new Set(sorted.map((row) => row.company_id).filter((id): id is string => Boolean(id)))],
      };
    })
    .sort((a, b) => Number(b.needsAPerson) - Number(a.needsAPerson) || b.count - a.count);
}

/**
 * How many failures raise the alarm: actionable groups that repeated at
 * least ALARM_AT times. Zero means nothing here needs a person.
 */
export function alarming(groups: readonly FailureGroup[]): number {
  return groups
    .filter((group) => group.needsAPerson && group.count >= ALARM_AT)
    .reduce((sum, group) => sum + group.count, 0);
}
