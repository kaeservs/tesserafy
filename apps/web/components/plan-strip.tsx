import Link from 'next/link';

export interface PlanStripMeter {
  readonly meter: string;
  readonly limit: number | null;
  readonly used: number;
}

const NOUN: Record<string, string> = {
  calls: 'imported calls',
  extractions: '“Find insights”',
  pattern_runs: 'pattern runs',
  questions: 'questions to Ask',
  live_seconds: 'live minutes',
};

/** The meter nearest its limit, and how near: what the strip mentions. */
export function nearestLimit(meters: readonly PlanStripMeter[]): { meter: PlanStripMeter; share: number } | null {
  return (
    meters
      .filter((meter) => meter.limit !== null && meter.limit > 0)
      .map((meter) => ({ meter, share: meter.used / (meter.limit ?? 1) }))
      .sort((a, b) => b.share - a.share)[0] ?? null
  );
}

/**
 * The plan on Home, when it is worth a line (ADR 0027): on the old trial, or
 * with an allowance four-fifths used. An owner gets the way to
 * upgrade; a member, who to ask. Silent otherwise — a plan with room is not
 * news.
 */
export function PlanStrip({
  plan,
  planName,
  meters,
  isOwner,
}: {
  plan: string;
  planName: string;
  meters: readonly PlanStripMeter[];
  isOwner: boolean;
}) {
  if (plan === 'pilot' || plan === 'internal') return null;
  const nearest = nearestLimit(meters);
  // Free has its banner across every page (the dashboard layout); here only when running out.
  const starting = plan === 'trial' || plan === 'none';
  if (!starting && (!nearest || nearest.share < 0.8)) return null;
  const minutes = nearest?.meter.meter === 'live_seconds';
  const used = nearest ? (minutes ? Math.ceil(nearest.meter.used / 60) : nearest.meter.used) : 0;
  const limit = nearest ? (minutes ? Math.round((nearest.meter.limit ?? 0) / 60) : nearest.meter.limit) : 0;
  return (
    <p className="card plan-strip" role="status">
      <strong>{plan === 'none' ? 'No plan' : planName}</strong>
      {nearest ? ` · ${used} of ${limit} ${NOUN[nearest.meter.meter] ?? nearest.meter.meter} used this month.` : '.'}{' '}
      {isOwner ? (
        <Link href="/settings/membership">{starting ? 'Choose a plan' : 'Upgrade or add seats'}</Link>
      ) : (
        <span className="muted">An owner can change the plan.</span>
      )}
    </p>
  );
}
