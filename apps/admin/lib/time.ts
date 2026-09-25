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
