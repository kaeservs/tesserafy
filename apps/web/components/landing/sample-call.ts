/**
 * The sample call on the landing page, and everything the overlay demo says
 * about it. Written for the page and played in the visitor's browser: no
 * call, no model, nothing sent anywhere.
 *
 * Only the detector is scripted. Each customer line says which criterion it
 * bears on and how sure a detector would be; the scorecard — every chip, the
 * score, a criterion's "1/2" — is worked out from that by packages/scoring,
 * the same pure function the overlay runs on a real call. And as in the
 * product, every point an answer makes about the call quotes a line already
 * said: test/landing-demo.test.ts holds the page to that.
 */
import { defineCriteriaSet, replay, score, type CriterionScore, type DetectorEvent, type Scorecard } from '@tesserafy/scoring';

export type Side = 'me' | 'them';
type Key = 'pain' | 'cost' | 'timeline' | 'decision_maker' | 'next_step';

export const SAMPLE_CRITERIA = defineCriteriaSet({
  engagementType: 'discovery',
  version: 1,
  criteria: [
    { key: 'pain', label: 'Pain', weight: 3 },
    { key: 'cost', label: 'Cost', weight: 2 },
    { key: 'timeline', label: 'Timeline', weight: 2 },
    { key: 'decision_maker', label: 'Decision maker', weight: 2 },
    { key: 'next_step', label: 'Next step', weight: 1 },
  ],
});

export interface Suggestion {
  readonly ask: string;
  /** The customer's words it answers to. */
  readonly because: string;
}

export interface SampleLine {
  readonly side: Side;
  /** Into the call, as mm:ss. */
  readonly at: string;
  readonly text: string;
  /** What a detector finds in a customer's line: the criterion, the words, how sure, and what it establishes. */
  readonly evidence?: { readonly criterion: Key; readonly quote: string; readonly confidence: number; readonly means: string };
  /** The one live suggestion this line prompts; null takes the last one down. */
  readonly suggests?: Suggestion | null;
}

export const SAMPLE_CALL: readonly SampleLine[] = [
  { side: 'me', at: '00:04', text: 'Thanks for making time, Dana. How is month-end looking for you?' },
  {
    side: 'them',
    at: '00:11',
    text: 'Honestly, it’s a slog. Month-end reporting takes us two full days every month.',
    evidence: { criterion: 'pain', quote: 'takes us two full days every month', confidence: 0.91, means: 'Month-end reporting takes them two full days' },
    suggests: { ask: 'Ask what those two days cost them.', because: 'takes us two full days every month' },
  },
  { side: 'me', at: '00:24', text: 'Two days is a lot. What does that cost the team?' },
  {
    side: 'them',
    at: '00:31',
    text: 'It adds up. We pay overtime for most of it.',
    evidence: { criterion: 'cost', quote: 'We pay overtime for most of it', confidence: 0.64, means: 'Most of it is paid as overtime' },
  },
  {
    side: 'them',
    at: '00:40',
    text: 'If we closed in a day, that’s about eight thousand a month back.',
    evidence: { criterion: 'cost', quote: 'about eight thousand a month back', confidence: 0.86, means: 'Closing in a day is worth about eight thousand a month' },
    suggests: { ask: 'Ask when it needs to be working.', because: 'about eight thousand a month back' },
  },
  { side: 'me', at: '00:52', text: 'When would you want something in place?' },
  {
    side: 'them',
    at: '00:58',
    text: 'We’d want it live before the Q3 board review.',
    evidence: { criterion: 'timeline', quote: 'live before the Q3 board review', confidence: 0.88, means: 'They want it live before the Q3 board review' },
    suggests: { ask: 'Ask who else needs to sign off.', because: 'live before the Q3 board review' },
  },
  {
    side: 'them',
    at: '01:09',
    text: 'And I’d have to run it past our CFO, Priya, first.',
    evidence: { criterion: 'decision_maker', quote: 'run it past our CFO, Priya', confidence: 0.9, means: 'Priya, their CFO, has to agree' },
    suggests: { ask: 'Offer a call with Priya next week.', because: 'run it past our CFO, Priya' },
  },
  { side: 'me', at: '01:18', text: 'Makes sense. Shall we set up time with Priya next week?' },
  {
    side: 'them',
    at: '01:25',
    text: 'Yes, Thursday works for both of us.',
    evidence: { criterion: 'next_step', quote: 'Thursday works for both of us', confidence: 0.87, means: 'A call with Priya on Thursday' },
    suggests: null,
  },
];

/** The prep's questions, kept on screen through the call; one is done when its criterion is confirmed. */
export const TO_ASK: readonly { readonly ask: string; readonly criterion: Key }[] = [
  { ask: 'What does month-end take your team today?', criterion: 'pain' },
  { ask: 'What would a faster close be worth?', criterion: 'cost' },
  { ask: 'Who else signs off on a change like this?', criterion: 'decision_maker' },
];

function msOf(at: string): number {
  const [minutes = 0, seconds = 0] = at.split(':').map(Number);
  return (minutes * 60 + seconds) * 1000;
}

/** The detector's findings in the first `heard` lines, as the scoring engine takes them. */
function eventsOf(heard: number): DetectorEvent[] {
  return SAMPLE_CALL.slice(0, heard).flatMap((line, index): DetectorEvent[] => {
    if (!line.evidence) return [];
    const startMs = msOf(line.at);
    return [
      {
        kind: 'evidence',
        criterionKey: line.evidence.criterion,
        confidence: line.evidence.confidence,
        span: { segmentId: `sample-${index}`, startMs, endMs: startMs + 5000, quote: line.evidence.quote },
      },
    ];
  });
}

/** The scorecard once `heard` lines have been said: packages/scoring's, not the page's. */
export function scorecardAfter(heard: number): Scorecard {
  return score(replay(SAMPLE_CRITERIA, eventsOf(heard)));
}

/** The suggestion on screen after `heard` lines: the latest one, until something takes it down. */
export function suggestionAfter(heard: number): Suggestion | null {
  let current: Suggestion | null = null;
  for (const line of SAMPLE_CALL.slice(0, heard)) {
    if (line.suggests !== undefined) current = line.suggests;
  }
  return current;
}

/** Each side's share of the words said so far: arithmetic, as in the overlay's talk-time. */
export function talkShares(heard: number): { me: number; them: number; words: number } {
  let me = 0;
  let them = 0;
  for (const line of SAMPLE_CALL.slice(0, heard)) {
    const words = line.text.split(/\s+/).filter(Boolean).length;
    if (line.side === 'me') me += words;
    else them += words;
  }
  const words = me + them;
  return { me: words ? me / words : 0, them: words ? them / words : 0, words };
}

export type AssistMode = 'assist' | 'say' | 'followups' | 'recap';

export interface Point {
  readonly text: string;
  /** The customer's words it rests on, verbatim from a line already said. */
  readonly quote?: string;
}

export interface Answer {
  readonly title: string;
  readonly points: readonly Point[];
}

const TITLES: Record<AssistMode, string> = {
  assist: 'Assist',
  say: 'What to say',
  followups: 'Follow-up questions',
  recap: 'Recap',
};

/** What each criterion needs said, in the seller's words. */
const NEEDS: Record<Key, { readonly say: string; readonly again: string; readonly followup: string }> = {
  pain: {
    say: 'Open on month-end: “What does it take your team today?”',
    again: 'Ask what month-end costs them in time once more: one more mention confirms it.',
    followup: 'Where does month-end slow you down most?',
  },
  cost: {
    say: 'Put a number on it: “What do those two days cost you?”',
    again: 'Put a number on it: “What does the overtime come to in a month?”',
    followup: 'What would getting those days back be worth?',
  },
  timeline: {
    say: 'Ask when it has to work: “When would you want this in place?”',
    again: 'Pin the date down: “What happens if it isn’t ready by then?”',
    followup: 'When does this need to be live?',
  },
  decision_maker: {
    say: 'Find who signs off: “Who else needs to see this before the Q3 review?”',
    again: 'Ask who else has a say: “Is Priya the one who signs?”',
    followup: 'Who else has a say in this?',
  },
  next_step: {
    say: 'Propose the next step: “Shall we set up time with Priya next week?”',
    again: 'Confirm the next step: “Can I send an invite for it now?”',
    followup: 'What would a good next step look like?',
  },
};

function keyOf(criterion: CriterionScore): Key {
  return criterion.key as Key;
}

/** The evidence the engine accepted for a criterion, strongest first, with what each piece establishes. */
function said(criterion: CriterionScore): { quote: string; means: string }[] {
  return [...criterion.evidence]
    .sort((a, b) => b.confidence - a.confidence)
    .map((recorded) => ({
      quote: recorded.span.quote,
      means: SAMPLE_CALL.find((line) => line.evidence?.quote === recorded.span.quote)?.evidence?.means ?? criterion.label,
    }));
}

function quoting(text: string, evidence: { quote: string } | undefined): Point {
  return evidence ? { text, quote: evidence.quote } : { text };
}

/** What the four buttons answer, from what has been said so far. */
export function assist(mode: AssistMode, heard: number): Answer {
  const criteria = scorecardAfter(heard).criteria;
  const open = criteria.filter((criterion) => criterion.status !== 'confirmed');
  const confirmed = criteria.filter((criterion) => criterion.status === 'confirmed');
  const title = TITLES[mode];

  if (mode === 'say') {
    const next = open[0];
    if (!next) {
      const last = criteria.at(-1);
      return { title, points: [quoting('Confirm Thursday, and say you will send the recap today.', last ? said(last)[0] : undefined)] };
    }
    if (next.status === 'candidate') return { title, points: [quoting(NEEDS[keyOf(next)].again, said(next)[0])] };
    const before = criteria[criteria.indexOf(next) - 1];
    return { title, points: [quoting(NEEDS[keyOf(next)].say, before ? said(before)[0] : undefined)] };
  }

  if (mode === 'assist') {
    if (confirmed.length === 0 && open.every((criterion) => criterion.status === 'unobserved')) {
      return { title, points: [{ text: 'Nothing on the scorecard yet: let Dana describe month-end in her own words.' }] };
    }
    const latest = [...confirmed].sort(
      (a, b) => Math.max(...b.evidence.map((r) => r.seq)) - Math.max(...a.evidence.map((r) => r.seq)),
    )[0];
    const points: Point[] = [];
    if (latest) points.push(quoting(`${latest.label} is confirmed — build on it.`, said(latest)[0]));
    for (const candidate of open.filter((criterion) => criterion.status === 'candidate')) {
      points.push(quoting(`${candidate.label} is mentioned once: one more mention confirms it.`, said(candidate)[0]));
    }
    const next = open.find((criterion) => criterion.status === 'unobserved');
    if (next) points.push({ text: `Still open: ${next.label.toLowerCase()}. ${NEEDS[keyOf(next)].followup}` });
    if (open.length === 0) points.push({ text: 'Everything on the scorecard is covered. Agree the agenda for Thursday.' });
    return { title, points };
  }

  if (mode === 'followups') {
    if (open.length === 0) {
      const last = criteria.at(-1);
      return { title, points: [quoting('Everything is covered: confirm Thursday, and who will be there.', last ? said(last)[0] : undefined)] };
    }
    return { title, points: open.slice(0, 3).map((criterion) => ({ text: NEEDS[keyOf(criterion)].followup })) };
  }

  const recap = criteria.flatMap((criterion) => {
    if (criterion.status === 'confirmed') {
      const best = said(criterion)[0];
      return best ? [quoting(best.means, best)] : [];
    }
    if (criterion.status === 'candidate') {
      const best = said(criterion)[0];
      return best ? [quoting(`${best.means} (mentioned once)`, best)] : [];
    }
    return [];
  });
  return { title, points: recap.length ? recap : [{ text: 'Nothing has been said yet.' }] };
}

const TOPICS: readonly { readonly key: Key; readonly words: RegExp }[] = [
  { key: 'decision_maker', words: /\b(who|decid\w*|sign\w*|cfo|priya|approv\w*|boss|buyer)\b/g },
  { key: 'timeline', words: /\b(when|timeline|deadline|date|q3|live|soon|urgent)\b/g },
  { key: 'cost', words: /\b(budget|cost\w*|worth|money|spend\w*|overtime|sav\w*|roi|value)\b/g },
  { key: 'pain', words: /\b(pain|problem\w*|month-end|slow\w*|hard|issue\w*|challeng\w*|why)\b/g },
  { key: 'next_step', words: /\b(next|follow\w*|thursday|meeting|step\w*|plan\w*)\b/g },
];

/** Our own price is not something the customer said: in the product it comes from the company's documents or not at all. */
const OUR_PRICE = /\b(price|pricing|discount|how much (is|does) tesserafy|how much do (we|you) charge)\b/;

/** The ask box, matched on keywords: what was said that answers it, quoted, or that nothing has. */
export function ask(question: string, heard: number): Answer | null {
  const asked = question.trim();
  if (!asked) return null;
  const title = `Answer · ${asked}`;
  const lower = asked.toLowerCase();
  if (OUR_PRICE.test(lower)) {
    return {
      title,
      points: [{ text: 'Your own price is not in this call. In the app it comes from your pricing documents, quoted and named — never a guess.' }],
    };
  }
  const best = TOPICS.map((topic) => ({ key: topic.key, hits: lower.match(topic.words)?.length ?? 0 }))
    .filter((topic) => topic.hits > 0)
    .sort((a, b) => b.hits - a.hits)[0];
  if (!best) {
    return { title, points: [{ text: 'Nothing said so far answers that. Try asking who decides, what it costs them, or when they need it.' }] };
  }
  const criterion = scorecardAfter(heard).criteria.find((c) => c.key === best.key);
  const evidence = criterion ? said(criterion) : [];
  if (evidence.length === 0) return { title, points: [{ text: `Not said yet. Try: “${NEEDS[best.key].followup}”` }] };
  return { title, points: evidence.map((piece) => quoting(piece.means, piece)) };
}
