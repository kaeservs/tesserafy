/**
 * A scorecard's name, as the overlay may send it.
 *
 * Which scorecard a call uses is decided in the dashboard now: the prep
 * chosen as the next call, or the company's default (/api/live/setup). The
 * overlay only checks that the name it was given is one, before it goes into
 * a request path.
 */

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;

/** A name as it may be stored or sent, or null. */
export function scorecardName(value: unknown): string | null {
  return typeof value === 'string' && NAME.test(value) ? value : null;
}
