/**
 * Reads that do not stop at a thousand rows.
 *
 * PostgREST returns at most `max_rows` rows per request — 1000 on this
 * project, measured — and says nothing when it truncates: the response is a
 * well-formed array that happens to be short. Every company-wide read in the
 * app was written before any company had that much, so past it a dashboard
 * would silently score calls on part of their evidence and a call page would
 * silently lose quotes. Nothing would error. That is the failure this exists
 * to make impossible.
 *
 * Two separate limits, two helpers:
 *   readAll  — pages a query with .range() until a page comes back empty.
 *   batches  — splits a long id list, because `.in('id', ids)` travels in the
 *              URL and a few hundred uuids is longer than a URL may be.
 *
 * readAll does not trust the server's cap to equal PAGE_SIZE. It moves on by
 * the rows that actually arrived, not by the rows it asked for, and stops only
 * on an empty page. Were the cap lowered to 500, asking for 0–999 would bring
 * back 0–499 and the next request would start at 500 — where advancing by the
 * page size would have skipped straight to 1000 and lost 500 rows without a
 * sound. One extra empty request is the price of not trusting the cap.
 *
 * Callers must order the query by something unique (usually `id`): paging an
 * unordered result can skip and repeat rows between pages.
 */

export const PAGE_SIZE = 1000;

/** Uuids per `.in()` filter: about 3.7 kB of URL, well under any limit. */
export const ID_BATCH = 100;

interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const from = rows.length;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${what} failed: ${error.message}`, { cause: error });
    const got = data ?? [];
    if (got.length === 0) return rows;
    rows.push(...got);
  }
}

export function batches<T>(items: readonly T[], size: number = ID_BATCH): T[][] {
  if (size < 1) throw new Error('batches: size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
