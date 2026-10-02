/**
 * The seller's own calls, as the home page leads with them: what happened this
 * week, which recent calls still have no follow-up email, and the last one.
 *
 * Pure: calls in, rows out. The page reads the calls once (loadScoredCalls)
 * and the drafted follow-ups once, and this decides what to show.
 */

export interface HomeCall {
  readonly id: string;
  readonly title: string;
  readonly occurred_at: string | null;
  readonly created_at: string;
  readonly added_by: string | null;
  readonly account_id: string | null;
}

/** Monday 00:00 UTC of the week `now` is in. */
export function startOfWeek(now: Date): Date {
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
}

const dateOf = (call: HomeCall) => call.occurred_at ?? call.created_at;

/** The person's own calls, newest first. */
export function myCalls<T extends HomeCall>(calls: readonly T[], userId: string): T[] {
  return calls.filter((call) => call.added_by === userId).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
}

export function callsThisWeek(mine: readonly HomeCall[], now: Date): number {
  const since = startOfWeek(now).toISOString();
  return mine.filter((call) => dateOf(call) >= since).length;
}

export interface FollowUpRow {
  readonly id: string;
  readonly title: string;
  readonly customer: string | null;
  readonly date: string;
  readonly drafted: boolean;
}

/**
 * The person's calls from the last `days`, each with whether its follow-up
 * email is drafted, the undrafted first: those are the ones to send.
 */
export function followUps(
  mine: readonly HomeCall[],
  drafted: ReadonlySet<string>,
  customers: ReadonlyMap<string, string>,
  now: Date,
  days = 14,
): FollowUpRow[] {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  return mine
    .filter((call) => dateOf(call) >= since)
    .map((call) => ({
      id: call.id,
      title: call.title,
      customer: call.account_id ? (customers.get(call.account_id) ?? null) : null,
      date: dateOf(call),
      drafted: drafted.has(call.id),
    }))
    .sort((a, b) => Number(a.drafted) - Number(b.drafted) || b.date.localeCompare(a.date));
}
