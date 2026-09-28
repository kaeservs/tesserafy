import { criteriaByOutcome, sellerProfile, type CoachingCall } from './coaching';
import { weekStart } from './report';

/**
 * One person's week, in one shape: what the "This week" page shows now and
 * what the weekly email will say once there is email. Pure — rows in, a
 * summary out — so the two can never disagree, and so it is tested here.
 *
 * Weeks run Monday to Sunday, UTC, as Reports' do. A call belongs to the week
 * it took place, or the week it was added when nobody said.
 */

const DAY = 86_400_000;

export interface WeeklyNote {
  readonly body: string;
  readonly author: string | null;
  readonly conversationId: string;
  readonly segmentId: string;
  readonly at: string;
}

export interface WeeklyInsight {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface WeeklySummary {
  /** Monday, YYYY-MM-DD. */
  readonly week: string;
  readonly previousWeek: string;
  /** Null for the current week: there is nothing after it yet. */
  readonly nextWeek: string | null;
  readonly mine: {
    readonly calls: readonly CoachingCall[];
    readonly average: number | null;
    readonly previousAverage: number | null;
    readonly won: number;
    readonly lost: number;
  };
  readonly company: { readonly calls: number; readonly average: number | null };
  /** Notes colleagues left this week on calls I added. */
  readonly notesOnMine: readonly WeeklyNote[];
  /** Waiting for a decision now, and those proposed this week. */
  readonly insightsWaiting: readonly WeeklyInsight[];
  readonly insightsApproved: readonly WeeklyInsight[];
  /** Over my last eight weeks: the criterion I most trail the company on, when there is enough to say. */
  readonly focus: { readonly label: string; readonly rate: number; readonly companyRate: number } | null;
  /** What goes with a win, company-wide: the criterion with the largest gap, when there is enough to say. */
  readonly winning: { readonly label: string; readonly wonRate: number; readonly lostRate: number } | null;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function scores(calls: readonly CoachingCall[]): number[] {
  return calls.flatMap((call) => (call.score === null ? [] : [call.score]));
}

export function weeklySummary(input: {
  readonly userId: string;
  readonly calls: readonly CoachingCall[];
  readonly notes: readonly (WeeklyNote & { readonly conversationAddedBy: string | null })[];
  readonly insights: readonly WeeklyInsight[];
  readonly now: Date;
  /** Any day in the week wanted; this week when absent or in the future. */
  readonly week?: string | null;
}): WeeklySummary {
  const thisWeek = weekStart(input.now.toISOString());
  const asked = input.week && /^\d{4}-\d{2}-\d{2}$/.test(input.week) ? weekStart(`${input.week}T00:00:00Z`) : thisWeek;
  const week = asked > thisWeek ? thisWeek : asked;
  const previousWeek = new Date(Date.parse(week) - 7 * DAY).toISOString().slice(0, 10);
  const nextWeek = week === thisWeek ? null : new Date(Date.parse(week) + 7 * DAY).toISOString().slice(0, 10);
  const inWeek = (iso: string) => weekStart(iso) === week;

  const companyWeek = input.calls.filter((call) => inWeek(call.date));
  const mine = companyWeek.filter((call) => call.addedBy === input.userId).sort((a, b) => b.date.localeCompare(a.date));
  const minePrevious = input.calls.filter((call) => call.addedBy === input.userId && weekStart(call.date) === previousWeek);

  // Coaching over the eight weeks ending with this one: enough calls to mean
  // something, recent enough to be about how someone sells now.
  const since = new Date(Date.parse(week) - 7 * 7 * DAY).toISOString().slice(0, 10);
  const recent = input.calls.filter((call) => weekStart(call.date) >= since && weekStart(call.date) <= week);
  const profile = sellerProfile(recent, input.userId);
  const trailing = profile.criteria.find((criterion) => criterion.rate < criterion.companyRate) ?? null;
  const wins = criteriaByOutcome(input.calls).find((comparison) => comparison.enough);
  const best = wins?.criteria[0];

  return {
    week,
    previousWeek,
    nextWeek,
    mine: {
      calls: mine,
      average: mean(scores(mine)),
      previousAverage: mean(scores(minePrevious)),
      won: mine.filter((call) => call.outcome === 'won').length,
      lost: mine.filter((call) => call.outcome === 'lost').length,
    },
    company: { calls: companyWeek.length, average: mean(scores(companyWeek)) },
    notesOnMine: input.notes
      .filter((note) => note.conversationAddedBy === input.userId && note.author !== input.userId && inWeek(note.at))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(({ conversationAddedBy: _, ...note }) => note),
    insightsWaiting: input.insights.filter((insight) => insight.status === 'proposed'),
    insightsApproved: input.insights.filter(
      (insight) => insight.status === 'approved' && insight.decidedAt !== null && inWeek(insight.decidedAt),
    ),
    focus: trailing ? { label: trailing.label, rate: trailing.rate, companyRate: trailing.companyRate } : null,
    winning: best && best.gap > 0 ? { label: best.label, wonRate: best.wonRate, lostRate: best.lostRate } : null,
  };
}
