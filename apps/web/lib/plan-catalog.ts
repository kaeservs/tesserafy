/**
 * The plans as people read them (ADR 0027): what each includes, in the
 * product's words, and what changes between two — for the onboarding's plan
 * step, the plans on Home, and the popup after a change of plan.
 */

export interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly price_usd_cents: number | null;
  readonly rank: number;
  readonly incognito: boolean;
  readonly per_seat: boolean;
  readonly max_seats: number | null;
  readonly calls: number | null;
  readonly extractions: number | null;
  readonly pattern_runs: number | null;
  readonly questions: number | null;
  readonly live_minutes: number | null;
  /** False: the allowance is given once, a trial (Free). */
  readonly renews: boolean;
  /** The longest call that may be imported, in minutes; null for no limit. */
  readonly max_call_minutes: number | null;
}

export const CATALOG_COLUMNS =
  'id, name, price_usd_cents, rank, incognito, per_seat, max_seats, calls, extractions, pattern_runs, questions, live_minutes, renews, max_call_minutes';

const METERS = [
  ['calls', 'imported call', 'imported calls'],
  ['extractions', '“Find insights”', '“Find insights”'],
  ['pattern_runs', 'pattern run', 'pattern runs'],
  ['questions', 'question to Ask', 'questions to Ask'],
  ['live_minutes', 'live minute', 'live minutes'],
] as const;

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** The cheapest price among plans that have one, for "plans start at …"; null when none is priced. */
export function startingPrice(plans: readonly CatalogRow[]): number | null {
  const prices = plans.flatMap((plan) => (plan.price_usd_cents === null ? [] : [plan.price_usd_cents]));
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** "$19.99 a seat a month", "Free". */
export function priceLine(plan: CatalogRow): string {
  if (plan.price_usd_cents === null) return plan.id === 'free' ? 'Free' : 'Set by Tesserafy';
  return `${dollars(plan.price_usd_cents)}${plan.per_seat ? ' a seat' : ''} a month`;
}

function count(n: number | null, one: string, many: string): string | null {
  if (n === null) return `Unlimited ${many}`;
  if (n === 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

/** How often an allowance comes: "a seat a month", "a month", or once on a trial. */
function period(plan: CatalogRow): string {
  if (!plan.renews) return ', once, as a trial';
  return plan.per_seat ? ' a seat a month' : ' a month';
}

/** What a plan includes, a line each, per seat where it is per seat. */
export function planFacts(plan: CatalogRow): string[] {
  const lines = METERS.map(([key, one, many]) => count(plan[key], one, many)).filter((line): line is string => line !== null);
  const facts = lines.length > 0 ? [`${lines.join(', ')}${period(plan)}`] : [];
  if (plan.max_call_minutes !== null) facts.push(`An imported call may be up to ${plan.max_call_minutes} minutes long`);
  facts.push(plan.max_seats === 1 ? 'Just you: one seat' : plan.per_seat ? 'As many seats as your team needs' : 'Your whole team');
  facts.push(plan.incognito ? 'The overlay is hidden from screen sharing' : 'The overlay shows if you share your screen');
  return facts;
}

/**
 * What moving from one plan to another changes, a line each, for the popup.
 * Allowances are compared per seat; seats and the overlay's visibility are
 * said when they change.
 */
export function planChanges(from: CatalogRow | null, to: CatalogRow): { direction: 'up' | 'down'; lines: string[] } {
  const direction = !from || to.rank >= from.rank ? 'up' : 'down';
  const lines: string[] = [];
  for (const [key, one, many] of METERS) {
    // Unlimited is null; a plan that is not there yet has none of anything.
    const before = from ? from[key] : 0;
    const after = to[key];
    if (after === before) continue;
    if (after === null) lines.push(`Unlimited ${many}`);
    else if (after === 0) lines.push(`No ${many}`);
    else {
      const was = !from ? '' : before === null ? ', down from unlimited' : `, ${after > before ? 'up' : 'down'} from ${before}`;
      lines.push(`${after} ${after === 1 ? one : many}${period(to)}${was}`);
    }
  }
  if (from && !from.renews && to.renews) lines.push('Every month, not once');
  if ((from?.max_seats ?? null) === 1 && to.max_seats !== 1) lines.push('Add teammates: every seat brings its own allowance');
  if (from && from.max_seats !== 1 && to.max_seats === 1) lines.push('One seat: just you');
  if (to.incognito && !from?.incognito) lines.push('The overlay is hidden from screen sharing');
  if (!to.incognito && from?.incognito) lines.push('From your next call, the overlay shows if you share your screen');
  return { direction, lines };
}
