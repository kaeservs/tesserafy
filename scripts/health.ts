/**
 * Is anything broken right now, and does anybody need to do something?
 *
 *   pnpm health [--hours 24] [--quiet]
 *
 * The table this reads exists because a failure used to have no destination
 * beyond the browser of whoever hit it. A table nobody reads is the same
 * blindness in a nicer shape, so this is the half that makes it monitoring:
 * something that looks, decides, and says so with an exit code.
 *
 * The exit code is the whole design. 0 means nothing needs a person, 1 means
 * something does. That is what lets a scheduled job be the alarm — GitHub
 * Actions already emails the repository owner when a scheduled run fails, so
 * this needs no paging vendor and no new egress to reach somebody.
 *
 * What counts as "needs a person" is the judgement, and it is deliberately
 * narrow. A model that was overloaded is weather. A caller that sent nonsense
 * is not our outage. A request we built wrong, or our own database refusing
 * us, is a bug that is live right now — and a bug that nobody can see is the
 * failure mode this whole thing was built to end. Two false alarms teach an
 * operator to ignore the alarm, which is worse than not having one.
 */
import { createServiceClient } from '@tesserafy/db';

/** The kinds that mean somebody must act today. */
const ACTIONABLE = new Set(['model_rejected', 'database']);

/**
 * Below this, an actionable failure is reported but does not fail the run.
 * One rejected request can be a fluke — a truncated deploy, a single bad
 * payload. Two inside the window is a pattern, and the four-merge outage would
 * have produced dozens within an hour.
 */
const ALARM_AT = 2;

interface FailureRow {
  source: string;
  kind: string;
  tier: string | null;
  model: string | null;
  status: number | null;
  message: string;
  created_at: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`health: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function ago(iso: string): string {
  // Clamped for the same reason as the support tool: a row written a moment
  // ago by a server whose clock is fractionally ahead should read "0m ago",
  // not "-1m ago" on the one screen somebody consults during an incident.
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

async function main(): Promise<void> {
  const hours = arg('hours', 24);
  const quiet = process.argv.includes('--quiet');

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await db
    .from('system_failures')
    .select('source, kind, tier, model, status, message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    // Being unable to read the failure table is itself the worst kind of
    // failure: it is the state in which nothing can be seen, which is exactly
    // what this exists to prevent. Loud, and exit 1.
    console.error(`health: could not read system_failures: ${error.message}`);
    process.exit(1);
  }

  const rows = (data ?? []) as FailureRow[];

  if (rows.length === 0) {
    if (!quiet) console.log(`health: nothing failed in the last ${hours}h.`);
    process.exit(0);
  }

  // Grouped by what broke and where, because twenty rows of the same 400 is
  // one problem and reading it twenty times does not make it clearer.
  const groups = new Map<string, { rows: FailureRow[] }>();
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.source}\u0000${row.status ?? ''}`;
    const group = groups.get(key) ?? { rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    const actionable = Number(ACTIONABLE.has(b.rows[0]!.kind)) - Number(ACTIONABLE.has(a.rows[0]!.kind));
    return actionable !== 0 ? actionable : b.rows.length - a.rows.length;
  });

  let alarming = 0;
  console.log(`health: ${rows.length} failure(s) in the last ${hours}h\n`);

  for (const group of ordered) {
    const first = group.rows[0]!;
    const needsAPerson = ACTIONABLE.has(first.kind);
    if (needsAPerson && group.rows.length >= ALARM_AT) alarming += group.rows.length;

    const mark = needsAPerson ? '!' : '-';
    const where = [first.source, first.tier, first.model, first.status]
      .filter(Boolean)
      .join(' ');
    console.log(`  ${mark} ${first.kind}  ${where}  ×${group.rows.length}  (last ${ago(first.created_at)})`);
    console.log(`      ${first.message.split('\n')[0]!.slice(0, 160)}`);
  }

  if (alarming === 0) {
    console.log(`\nNothing here needs a person: no bug of ours repeated ${ALARM_AT}+ times.`);
    process.exit(0);
  }

  console.log(
    `\n${alarming} failure(s) marked ! are requests we built wrong or our own database refusing us.`,
  );
  console.log('Those do not fix themselves. Exiting 1 so a scheduled run says so.');
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`health: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
