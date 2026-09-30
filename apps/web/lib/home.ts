import type { AttentionReason } from './accounts-attention';
import type { CoachingCall } from './coaching';
import type { Theme } from './themes';

/**
 * What needs you, on the dashboard: the few things the other pages each know
 * and nobody opens all of them to find out. Insights assigned to you or
 * waiting on a decision, customers gone quiet or whose last call went badly,
 * criteria below the goal an owner set, and themes climbing.
 *
 * A short list on purpose. Each kind shows its first few and a count of the
 * rest, linked to the page that has them all; a dashboard that lists every
 * customer is the Accounts page with a different heading.
 */

const DAY = 86_400_000;
/** Goals are measured over the last four weeks, as Reports measures them. */
export const GOAL_WINDOW_DAYS = 28;
/** Fewer scored calls than this and a rate says nothing about a goal. */
export const GOAL_MIN_CALLS = 3;
const SHOWN = 3;

export interface Goal {
  readonly engagementType: string;
  readonly key: string;
  readonly target: number;
}

export interface GoalStanding extends Goal {
  readonly label: string;
  readonly rate: number;
  readonly calls: number;
}

/**
 * Where each goal stands over the last four weeks, from the calls given — a
 * whole company's for an owner, a member's own for a member. A goal with too
 * few scored calls behind it is left out rather than called met or missed.
 */
export function goalStandings(calls: readonly CoachingCall[], goals: readonly Goal[], now: Date): GoalStanding[] {
  const since = now.getTime() - GOAL_WINDOW_DAYS * DAY;
  const recent = calls.filter((call) => call.score !== null && Date.parse(call.date) >= since);
  return goals.flatMap((goal) => {
    const carrying = recent.filter(
      (call) => call.engagementType === goal.engagementType && call.criteria.some((criterion) => criterion.key === goal.key),
    );
    if (carrying.length < GOAL_MIN_CALLS) return [];
    const met = carrying.filter((call) =>
      call.criteria.some((criterion) => criterion.key === goal.key && criterion.status === 'confirmed'),
    ).length;
    const label = carrying[0]!.criteria.find((criterion) => criterion.key === goal.key)!.label;
    return [{ ...goal, label, rate: met / carrying.length, calls: carrying.length }];
  });
}

export interface AgendaItem {
  readonly kind: 'prep' | 'coaching' | 'action' | 'assigned' | 'decide' | 'customer' | 'goal' | 'theme';
  readonly text: string;
  readonly href: string;
}

export interface AgendaInput {
  /** Commitments your side made on your calls, not yet ticked done. */
  readonly actions?: readonly { id: string; action: string; due: string | null; callTitle: string; conversationId: string; segmentId: string }[];
  /** Calls and moments a manager asked you to listen to, not yet done. */
  readonly coaching?: readonly { id: string; callTitle: string; conversationId: string; segmentId: string | null; from: string | null }[];
  /** Calls prepared for in the next few days, soonest first. */
  readonly preps?: readonly { id: string; personName: string; customer: string | null; callAt: string; hasBrief: boolean }[];
  readonly assignedToYou: readonly { id: string; title: string }[];
  readonly waitingForDecision: number;
  readonly customers: readonly {
    id: string;
    name: string;
    reasons: readonly AttentionReason[];
    lastCallAt: string | null;
    lastScore: number | null;
  }[];
  readonly goals: readonly GoalStanding[];
  readonly themes: readonly Theme[];
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function homeAgenda(input: AgendaInput): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const prep of input.preps ?? []) {
    const when = new Date(prep.callAt).toLocaleString('en-GB', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    items.push({
      kind: 'prep',
      text: `Call with ${prep.personName}${prep.customer ? ` (${prep.customer})` : ''}, ${when} UTC: ${prep.hasBrief ? 'brief ready' : 'no brief yet'}`,
      href: `/prep/${prep.id}`,
    });
  }

  const coaching = input.coaching ?? [];
  for (const item of coaching.slice(0, SHOWN)) {
    items.push({
      kind: 'coaching',
      text: `Listen to ${item.callTitle}${item.from ? `, from ${item.from}` : ''}`,
      href: `/conversations/${item.conversationId}${item.segmentId ? `#segment-${item.segmentId}` : ''}`,
    });
  }
  if (coaching.length > SHOWN) {
    items.push({ kind: 'coaching', text: `and ${coaching.length - SHOWN} more to listen to`, href: '/coaching' });
  }

  const actions = input.actions ?? [];
  for (const item of actions.slice(0, SHOWN)) {
    items.push({
      kind: 'action',
      text: `${item.action}${item.due ? `, due ${item.due}` : ''} (${item.callTitle})`,
      href: `/conversations/${item.conversationId}#segment-${item.segmentId}`,
    });
  }
  if (actions.length > SHOWN) {
    items.push({ kind: 'action', text: `and ${actions.length - SHOWN} more open action items on your calls`, href: '/conversations' });
  }

  for (const insight of input.assignedToYou.slice(0, SHOWN)) {
    items.push({ kind: 'assigned', text: `Assigned to you: ${insight.title}`, href: `/insights/${insight.id}` });
  }
  if (input.assignedToYou.length > SHOWN) {
    items.push({ kind: 'assigned', text: `and ${input.assignedToYou.length - SHOWN} more assigned to you`, href: '/insights?status=mine' });
  }

  if (input.waitingForDecision > 0) {
    items.push({
      kind: 'decide',
      text: `${input.waitingForDecision} insight${input.waitingForDecision === 1 ? '' : 's'} waiting for a decision`,
      href: '/insights?status=proposed',
    });
  }

  for (const customer of input.customers.slice(0, SHOWN)) {
    const why = customer.reasons.includes('quiet')
      ? `deal open, no call since ${customer.lastCallAt ? day(customer.lastCallAt) : 'the first'}`
      : `last call scored ${Math.round(customer.lastScore ?? 0)}`;
    items.push({ kind: 'customer', text: `${customer.name}: ${why}`, href: `/accounts/${customer.id}` });
  }
  if (input.customers.length > SHOWN) {
    items.push({ kind: 'customer', text: `and ${input.customers.length - SHOWN} more customers need attention`, href: '/accounts' });
  }

  for (const goal of input.goals.filter((standing) => standing.rate < standing.target)) {
    items.push({
      kind: 'goal',
      text: `${goal.label} met on ${percent(goal.rate)} of ${goal.calls} calls, against a goal of ${percent(goal.target)}`,
      href: '/reports',
    });
  }

  const climbing = input.themes.filter((theme) => theme.trend === 'rising' || theme.trend === 'new');
  for (const theme of climbing.slice(0, SHOWN)) {
    items.push({
      kind: 'theme',
      text:
        theme.trend === 'new'
          ? `New theme: ${theme.title}, ${theme.recent} call${theme.recent === 1 ? '' : 's'} in four weeks`
          : `Rising: ${theme.title}, ${theme.recent} calls in four weeks against ${theme.previous} before`,
      href: `/insights/${theme.id}`,
    });
  }

  return items;
}
