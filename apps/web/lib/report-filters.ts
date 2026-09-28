import type { CoachingCall } from './coaching';

/**
 * What Reports is looking at: how many weeks, and which calls. Parsed from the
 * URL (a GET form, so a view can be sent to someone) and applied before any
 * number is worked out, so every table on the page — and its CSV — answers
 * the same question.
 *
 * Sellers follow Reports' rule: an owner may look at anyone; a member may look
 * at the company, or at their own calls, never a colleague's alone.
 */

export const RANGES = { 4: 'Last 4 weeks', 12: 'Last 12 weeks', 26: 'Last 6 months', 52: 'Last year' } as const;
export type Range = keyof typeof RANGES;

export interface ReportFilters {
  readonly weeks: Range;
  readonly type: string | null;
  readonly account: string | null;
  /** A user id, or 'mine'. */
  readonly seller: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReportFilters(
  params: Record<string, string | string[] | undefined>,
  viewer: { isOwner: boolean },
): ReportFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  };
  const weeks = Number(one('weeks'));
  const seller = one('seller');
  const type = one('type');
  const account = one('account');
  const allowedSeller = seller === 'mine' || (viewer.isOwner && UUID.test(seller)) ? seller : null;
  return {
    weeks: weeks in RANGES ? (weeks as Range) : 12,
    type: /^[a-z][a-z0-9_-]{0,39}$/.test(type) ? type : null,
    account: UUID.test(account) ? account : null,
    seller: allowedSeller,
  };
}

/** The calls the filters select; the range is applied by whoever builds weeks. */
export function filterCalls<T extends CoachingCall>(calls: readonly T[], filters: ReportFilters, userId: string | null): T[] {
  const sellerId = filters.seller === 'mine' ? userId : filters.seller;
  return calls.filter(
    (call) =>
      (!filters.type || call.engagementType === filters.type) &&
      (!filters.account || call.accountId === filters.account) &&
      (!sellerId || call.addedBy === sellerId),
  );
}

/** The same filters as a query string, for links and the CSV. */
export function reportQuery(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (filters.weeks !== 12) params.set('weeks', String(filters.weeks));
  if (filters.type) params.set('type', filters.type);
  if (filters.account) params.set('account', filters.account);
  if (filters.seller) params.set('seller', filters.seller);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}
