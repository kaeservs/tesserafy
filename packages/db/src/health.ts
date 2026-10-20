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
export const ACTIONABLE_KINDS: ReadonlySet<string> = new Set(['model_rejected', 'database', 'billing', 'tenant_boundary']);

/**
 * Below this, an actionable failure is reported but does not raise the alarm.
 * One rejected request can be a fluke — a truncated deploy, a single bad
 * payload. Two inside the window is a pattern.
 */
export const ALARM_AT = 2;

/**
 * The kinds that raise the alarm the first time. One company's row where
 * another's was asked for is never a fluke worth waiting for a second of.
 */
export const ALARM_AT_ONCE: ReadonlySet<string> = new Set(['tenant_boundary']);

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

/** What a tier or a model name is made of. */
const NAME = /^[a-z0-9._-]{1,64}$/i;

/** Shown in place of a tier or a model that is not a name. */
export const UNRECOGNISED = '(unrecognised)';

/**
 * A tier or a model as it may be shown: the name itself, or UNRECOGNISED.
 *
 * Both are written by whoever calls record_failure, and any signed-in member
 * can. `pnpm health` prints them into a public Actions log, where a line that
 * starts with `::` is an instruction to the runner: a model holding a newline
 * and `::error title=…::…` would be an annotation on this repository and in
 * the failure email. A name has no newline, no colon and no space in it, so
 * anything else is shown as unrecognised rather than as written.
 */
export function printableName(value: string | null): string | null {
  return value === null || NAME.test(value) ? value : UNRECOGNISED;
}

export interface FailureGroup {
  readonly kind: string;
  readonly source: string;
  readonly status: number | null;
  /** A name, or UNRECOGNISED: see printableName. */
  readonly tier: string | null;
  /** A name, or UNRECOGNISED: see printableName. */
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
        // Checked here, once, so the console's Failures page and the alarm
        // show the same thing, and neither shows what a caller made up.
        tier: printableName(latest.tier),
        model: printableName(latest.model),
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
 * least ALARM_AT times, or of a kind that alarms at once. Zero means nothing
 * here needs a person.
 */
export function alarming(groups: readonly FailureGroup[]): number {
  return groups
    .filter((group) => group.needsAPerson && (group.count >= ALARM_AT || ALARM_AT_ONCE.has(group.kind)))
    .reduce((sum, group) => sum + group.count, 0);
}
