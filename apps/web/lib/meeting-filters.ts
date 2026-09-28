/**
 * Finding a meeting: search, filters, sort and pages for the Meetings list.
 *
 * Scores are never stored (invariant 1, the P9 gate), so filtering or sorting
 * by score cannot happen in SQL. The page narrows in SQL on what is stored —
 * title, seller, scorecard — scores only what is left, and this module does
 * the rest: dates, score band, sort, and the page. At today's size that is
 * what the page did anyway (it scored every call); it is the thing to revisit
 * when a company has thousands of calls, with a cached read model rather
 * than a stored score.
 *
 * Everything here is pure, and every filter lives in the URL: a GET form, so a
 * filtered list survives a reload and can be sent to someone.
 */

export const PAGE_SIZE = 25;

export type ScoreBand = 'unscored' | 'low' | 'mid' | 'high';
export type OutcomeFilter = 'won' | 'lost' | 'open' | 'none';

export const OUTCOMES: Record<OutcomeFilter, string> = {
  won: 'Won',
  lost: 'Lost',
  open: 'Still open',
  none: 'Not said',
};
export type MeetingSort = 'newest' | 'oldest' | 'highest' | 'lowest' | 'title';

export const BANDS: Record<ScoreBand, string> = {
  high: '80 and above',
  mid: '50 to 79',
  low: 'Below 50',
  unscored: 'Not scored',
};

export const SORTS: Record<MeetingSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  highest: 'Highest score',
  lowest: 'Lowest score',
  title: 'Title, A to Z',
};

export interface MeetingFilters {
  readonly q: string;
  /** A user id, or 'mine'. Owners may pick anyone; members only themselves. */
  readonly seller: string | null;
  readonly type: string | null;
  /** YYYY-MM-DD, inclusive, on the meeting's date (or its import date). */
  readonly from: string | null;
  readonly to: string | null;
  readonly band: ScoreBand | null;
  /** Stored, so filtered in SQL. */
  readonly outcome: OutcomeFilter | null;
  readonly sort: MeetingSort;
  readonly page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/** What the URL asked for; anything malformed is dropped rather than guessed at. */
export function parseFilters(params: Record<string, string | string[] | undefined>): MeetingFilters {
  const seller = one(params['seller']);
  const band = one(params['score']);
  const outcome = one(params['outcome']);
  const sort = one(params['sort']);
  const page = Number.parseInt(one(params['page']), 10);
  const from = one(params['from']);
  const to = one(params['to']);
  const type = one(params['type']);
  return {
    q: one(params['q']).slice(0, 100),
    seller: seller === 'mine' || UUID.test(seller) ? seller : null,
    type: /^[a-z][a-z0-9_-]{0,39}$/.test(type) ? type : null,
    from: DAY.test(from) ? from : null,
    to: DAY.test(to) ? to : null,
    band: band in BANDS ? (band as ScoreBand) : null,
    outcome: outcome in OUTCOMES ? (outcome as OutcomeFilter) : null,
    sort: sort in SORTS ? (sort as MeetingSort) : 'newest',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** Whether anything narrows the list, so the page can say "none match" rather than "none yet". */
export function isFiltered(filters: MeetingFilters): boolean {
  return Boolean(
    filters.q || filters.seller || filters.type || filters.from || filters.to || filters.band || filters.outcome,
  );
}

/** For `ilike`: the search is for the words typed, not a pattern. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export function bandOf(score: number | null): ScoreBand {
  if (score === null) return 'unscored';
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

export interface FilterableMeeting {
  readonly title: string;
  readonly occurred_at: string | null;
  readonly created_at: string;
  /** Null when nothing was heard: "not scored", which is not the same as zero. */
  readonly score: number | null;
}

/** The meeting's own date when it has one, the day it was imported when not. */
export function dayOf(meeting: FilterableMeeting): string {
  return (meeting.occurred_at ?? meeting.created_at).slice(0, 10);
}

export interface MeetingPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pages: number;
}

/**
 * Dates, band and sort, over meetings already narrowed in SQL: every match,
 * for the CSV. Unscored meetings sort last whichever way scores are sorted: a
 * call nobody scored is neither the best nor the worst.
 */
export function filterAndSort<T extends FilterableMeeting>(meetings: readonly T[], filters: MeetingFilters): T[] {
  const kept = meetings.filter((meeting) => {
    const day = dayOf(meeting);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (filters.band && bandOf(meeting.score) !== filters.band) return false;
    return true;
  });

  const byDate = (a: T, b: T) =>
    (b.occurred_at ?? b.created_at).localeCompare(a.occurred_at ?? a.created_at);
  const byScore = (direction: 1 | -1) => (a: T, b: T) => {
    if (a.score === null && b.score === null) return byDate(a, b);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return direction * (a.score - b.score) || byDate(a, b);
  };
  const order: Record<MeetingSort, (a: T, b: T) => number> = {
    newest: byDate,
    oldest: (a, b) => -byDate(a, b),
    highest: byScore(-1),
    lowest: byScore(1),
    title: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || byDate(a, b),
  };
  return [...kept].sort(order[filters.sort]);
}

/** The same, a page at a time, for the list. A page past the end shows the last. */
export function applyFilters<T extends FilterableMeeting>(meetings: readonly T[], filters: MeetingFilters): MeetingPage<T> {
  const sorted = filterAndSort(meetings, filters);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  return {
    items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: sorted.length,
    page,
    pages,
  };
}

/** The same filters as a query string, with some changed: for page links and the CSV. */
export function hrefWith(
  filters: MeetingFilters,
  change: Partial<MeetingFilters>,
  path = '/conversations',
): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.seller) params.set('seller', next.seller);
  if (next.type) params.set('type', next.type);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.band) params.set('score', next.band);
  if (next.outcome) params.set('outcome', next.outcome);
  if (next.sort !== 'newest') params.set('sort', next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
