/**
 * CSV for a spreadsheet, safely.
 *
 * Two things go wrong with naive CSV. A comma, quote or line break inside a
 * value breaks the row, so every such value is quoted and its quotes doubled
 * (RFC 4180). And a spreadsheet treats a cell that starts with `=`, `+`, `-`
 * or `@` as a formula: a call titled `=HYPERLINK("http://…")` would become a
 * live link — or worse — on the machine of whoever opens the export. Titles
 * and names here are typed by users, so such a cell is prefixed with `'`,
 * which spreadsheets show as the text it is.
 *
 * Numbers are written as numbers; a negative number is a number, not a
 * formula, and is left alone.
 */

export type Cell = string | number | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const guarded = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows to CSV text, header first, CRLF between rows as the RFC and Excel expect. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const BOM = String.fromCharCode(0xfeff);

/** A download: UTF-8 with a byte-order mark, so Excel reads "Café" as Café. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(`${BOM}${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/** "acme-robotics-meetings-2026-09-28.csv". */
export function csvFilename(company: string, what: string, now: Date = new Date()): string {
  const slug = company
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'company'}-${what}-${now.toISOString().slice(0, 10)}.csv`;
}
