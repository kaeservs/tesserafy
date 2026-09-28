import { weekStart } from './report';

/**
 * Themes over time: for each insight, how many calls a week raised it, and
 * whether that is climbing — "is the export complaint growing, or fading since
 * we shipped the fix?"
 *
 * Counted in calls, not signals, for the same reason the list beside it shows
 * both: one customer saying it four times is not four customers. A call counts
 * in the week the meeting took place, not the week it was imported.
 *
 * Dismissed insights are left out; a person already said they are not a theme.
 * Beside the themes, every problem and request per week, grouped or not, so a
 * rise nobody has grouped into an insight yet still shows.
 */

const DAY = 86_400_000;
/** Four weeks against the four before, as Reports compares criteria. */
const SPAN = 4;

export interface ThemeInput {
  readonly insights: readonly { id: string; title: string; status: string }[];
  readonly evidence: readonly { insightId: string; signalId: string }[];
  readonly signals: readonly { id: string; conversationId: string; kind: string }[];
  /** When each call took place: occurred_at, else when it was added. */
  readonly callDate: ReadonlyMap<string, string>;
}

export type ThemeTrend = 'rising' | 'falling' | 'steady' | 'new';

export interface Theme {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  /** Calls raising it, per week, oldest first. */
  readonly calls: readonly number[];
  readonly recent: number;
  readonly previous: number;
  readonly trend: ThemeTrend;
}

export interface Themes {
  /** Monday of each week, oldest first. */
  readonly weeks: readonly string[];
  readonly themes: readonly Theme[];
  /** Every signal of each kind, per week — grouped into an insight or not. */
  readonly kinds: Readonly<Record<string, readonly number[]>>;
}

export function trendOf(recent: number, previous: number): ThemeTrend {
  if (previous === 0) return recent > 0 ? 'new' : 'steady';
  if (recent > previous) return 'rising';
  if (recent < previous) return 'falling';
  return 'steady';
}

export function themesOverTime(input: ThemeInput, now: Date, weeks = 12): Themes {
  const thisWeek = weekStart(now.toISOString());
  const starts = Array.from({ length: weeks }, (_, index) =>
    new Date(Date.parse(thisWeek) - (weeks - 1 - index) * 7 * DAY).toISOString().slice(0, 10),
  );
  const position = new Map(starts.map((week, index) => [week, index]));
  const weekOfCall = (conversationId: string): number | undefined => {
    const date = input.callDate.get(conversationId);
    return date === undefined ? undefined : position.get(weekStart(date));
  };

  const signalById = new Map(input.signals.map((signal) => [signal.id, signal]));
  const callsOf = new Map<string, Set<string>>();
  for (const row of input.evidence) {
    const signal = signalById.get(row.signalId);
    if (!signal) continue;
    const set = callsOf.get(row.insightId) ?? new Set<string>();
    set.add(signal.conversationId);
    callsOf.set(row.insightId, set);
  }

  const themes = input.insights
    .filter((insight) => insight.status !== 'dismissed')
    .map((insight) => {
      const calls = starts.map(() => 0);
      for (const conversationId of callsOf.get(insight.id) ?? []) {
        const index = weekOfCall(conversationId);
        if (index !== undefined) calls[index]! += 1;
      }
      const recent = calls.slice(-SPAN).reduce((a, b) => a + b, 0);
      const previous = calls.slice(-2 * SPAN, -SPAN).reduce((a, b) => a + b, 0);
      return { id: insight.id, title: insight.title, status: insight.status, calls, recent, previous, trend: trendOf(recent, previous) };
    })
    .filter((theme) => theme.calls.some((count) => count > 0))
    .sort((a, b) => b.recent - a.recent || b.previous - a.previous || a.title.localeCompare(b.title));

  const kinds: Record<string, number[]> = {};
  for (const signal of input.signals) {
    const index = weekOfCall(signal.conversationId);
    if (index === undefined) continue;
    const row = (kinds[signal.kind] ??= starts.map(() => 0));
    row[index]! += 1;
  }

  return { weeks: starts, themes, kinds };
}
