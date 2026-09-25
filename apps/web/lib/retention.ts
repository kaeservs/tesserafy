/**
 * The retention periods an owner is offered.
 *
 * The database accepts anything from a week to ten years; the product offers
 * a handful, because a free number field invites a typo that deletes a year
 * of calls. Every value here is inside the range `set_retention` enforces.
 */
export const RETENTION_CHOICES: readonly number[] = [30, 90, 180, 365, 730];

/** When the nightly purge runs, as scheduled in the retention migration. */
export const PURGE_TIME_UTC = '03:15 UTC';

export function describeRetention(days: number | null): string {
  if (days === null) return 'Calls are kept until someone deletes them.';
  return `Calls are deleted ${periodLabel(days)} after they took place.`;
}

export function periodLabel(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? '1 year' : `${years} years`;
  }
  return `${days} days`;
}
