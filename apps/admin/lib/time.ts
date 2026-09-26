/**
 * A moment, said in UTC and labelled as such.
 *
 * These pages render on the server, whose clock is UTC, while the operator
 * reads them wherever they are. An unlabelled "10:34" was UTC on the deployed
 * console and local time on a laptop, and nothing on the page said which — in
 * an audit log, of all places. So every time is UTC, and says so.
 */
export function utc(iso: string): string {
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** Roughly how long ago, in days. */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  // Clamped at zero. A timestamp can sit a moment in the future — the
  // server's clock against this one, or, in the support tool, the sign-in
  // this very command just performed — and an unclamped floor renders that
  // as "-1d ago", which reads like a bug in the data rather than in the
  // arithmetic.
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
