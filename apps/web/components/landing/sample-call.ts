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
 * said, and every line to say that answers the customer shows their words:
 * test/landing-demo.test.ts holds the page to that.
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
  /** What the seller could say, in their own words: never advice about saying it. */
  readonly say: string;
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
    suggests: { say: 'Two days is a lot. What does that cost the team?', because: 'takes us two full days every month' },
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
    suggests: { say: 'When would you want something in place?', because: 'about eight thousand a month back' },
  },
  { side: 'me', at: '00:52', text: 'When would you want something in place?' },
  {
    side: 'them',
    at: '00:58',
    text: 'We’d want it live before the Q3 board review.',
    evidence: { criterion: 'timeline', quote: 'live before the Q3 board review', confidence: 0.88, means: 'They want it live before the Q3 board review' },
    suggests: { say: 'Who else needs to sign off before the Q3 review?', because: 'live before the Q3 board review' },
  },
  {
    side: 'them',
    at: '01:09',
    text: 'And I’d have to run it past our CFO, Priya, first.',
    evidence: { criterion: 'decision_maker', quote: 'run it past our CFO, Priya', confidence: 0.9, means: 'Priya, their CFO, has to agree' },
    suggests: { say: 'Makes sense. Shall we set up time with Priya next week?', because: 'run it past our CFO, Priya' },
  },
  { side: 'me', at: '01:18', text: 'Makes sense. Shall we set up time with Priya next week?' },
  {
    side: 'them',
    at: '01:25',
    text: 'Yes, Thursday works for both of us.',
    evidence: { criterion: 'next_step', quote: 'Thursday works for both of us', confidence: 0.87, means: 'A call with Priya on Thursday' },
    suggests: { say: 'Thursday it is. Who else should join from your side?', because: 'Thursday works for both of us' },
  },
];

/** The prep's questions, kept on screen through the call; one is done when its criterion is confirmed. */
export const TO_ASK: readonly { readonly ask: string; readonly criterion: Key }[] = [
  { ask: 'What does month-end take your team today?', criterion: 'pain' },
  { ask: 'What would a faster close be worth?', criterion: 'cost' },
  { ask: 'Who else signs off on a change like this?', criterion: 'decision_maker' },
];

/** Into the call once `heard` lines have been said, in ms: the sample's own clock. */
export function callMsAfter(heard: number): number {
  return msOf(SAMPLE_CALL[heard - 1]?.at ?? '00:00');
}

/**
 * What pressing a button does, as in the overlay (apps/desktop/src/renderer/
 * answers.ts): ask again when its answer is already on screen, show the one
 * kept from earlier in the call, or ask for the first.
 */
export function pressAction(mode: AssistMode, shown: AssistMode | null, kept: boolean): 'ask' | 'recall' {
  if (shown === mode) return 'ask';
  return kept ? 'recall' : 'ask';
}

/** How long ago an answer was written, as its header says it (the overlay's words). */
export function sinceLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

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

/** The whole of the customer's line, already said, that holds these words. */
function theirLine(words: string, heard: number): string | null {
  return SAMPLE_CALL.slice(0, heard).find((line) => line.side === 'them' && line.text.includes(words))?.text ?? null;
}

/** The customer's last line, if they have said anything yet. */
function lastOfTheirs(heard: number): string | null {
  return SAMPLE_CALL.slice(0, heard).findLast((line) => line.side === 'them')?.text ?? null;
}

export interface SayNext {
  /** What to say: the largest words on the card. */
  readonly say: string;
  /** The customer's line it answers, word for word; null when it answers nothing said. */
  readonly them: string | null;
  /** The live suggestion, the prep's next question, or nothing yet (shown quieter). */
  readonly from: 'live' | 'prep' | 'waiting';
}

/**
 * What the overlay puts first after `heard` lines, by the overlay's own rule
 * (apps/desktop/src/renderer/say-next.ts): the live suggestion, else the
 * prep's next question the scorecard has not seen answered, else that it is
 * listening. Shown as a conversation: their line, then what to say to it.
 */
export function sayNextAfter(heard: number): SayNext {
  const suggestion = suggestionAfter(heard);
  if (suggestion) return { say: suggestion.say, them: theirLine(suggestion.because, heard), from: 'live' };
  const confirmed = new Set(
    scorecardAfter(heard)
      .criteria.filter((criterion) => criterion.status === 'confirmed')
      .map((criterion) => criterion.key),
  );
  const open = TO_ASK.find((item) => !confirmed.has(item.criterion));
  if (open) return { say: open.ask, them: null, from: 'prep' };
  return { say: 'What to say shows here as the customer talks.', them: null, from: 'waiting' };
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

/** The three buttons, by the overlay's names for them: AI Assist ("say"), To Ask and Recap. */
export type AssistMode = 'say' | 'followups' | 'recap';

export interface Point {
  readonly text: string;
  /** The customer's words it rests on, verbatim from a line already said. */
  readonly quote?: string;
}

/** A line to say, and the customer's line it answers, word for word, when it answers one. */
export interface Reply {
  readonly say: string;
  readonly them?: string;
}

/** What a button or the box gives back: lines to say, or notes about the call. */
export type Answer =
  | { readonly kind: 'say'; readonly title: string; readonly lines: readonly Reply[] }
  | { readonly kind: 'notes'; readonly title: string; readonly points: readonly Point[] };

const TITLES: Record<AssistMode, string> = {
  say: 'AI Assist',
  followups: 'To Ask',
  recap: 'Recap',
};

/** What the seller could say to bring each criterion out: asking it, and once it has been mentioned once. */
const NEEDS: Record<Key, { readonly ask: string; readonly again: string }> = {
  pain: { ask: 'What does month-end take your team today?', again: 'Where does month-end slow you down the most?' },
  cost: { ask: 'What would getting those days back be worth?', again: 'What does the overtime come to in a month?' },
  timeline: { ask: 'When would you want something in place?', again: 'What happens if it isn’t ready by then?' },
  decision_maker: { ask: 'Who else needs to sign off on this?', again: 'Is there anyone else who has to agree?' },
  next_step: { ask: 'Shall we set up time next week to take this further?', again: 'Can I send the invite now, while we’re both here?' },
};

/** Once everything on the scorecard is covered. */
const CLOSE = 'I’ll send the invite with a short agenda today. Anything you’d like on it?';
const LAST_ASK = 'What would make Thursday a good use of Priya’s time?';

function reply(say: string, them: string | null): Reply {
  return them ? { say, them } : { say };
}

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

/** What the three buttons give, from what has been said so far. */
export function assist(mode: AssistMode, heard: number): Answer {
  const criteria = scorecardAfter(heard).criteria;
  const open = criteria.filter((criterion) => criterion.status !== 'confirmed');
  const title = TITLES[mode];

  // AI Assist: the one thing to say now, answering their last words — what is half-said first, then what is not said.
  if (mode === 'say') {
    const candidate = open.find((criterion) => criterion.status === 'candidate');
    const next = candidate ?? open[0];
    const say = !next ? CLOSE : candidate ? NEEDS[keyOf(candidate)].again : NEEDS[keyOf(next)].ask;
    return { kind: 'say', title, lines: [reply(say, lastOfTheirs(heard))] };
  }

  // To Ask: the questions still worth asking — the prep's first, then whatever else the scorecard is missing.
  if (mode === 'followups') {
    if (open.length === 0) return { kind: 'say', title, lines: [{ say: LAST_ASK }] };
    const keys = open.map(keyOf);
    const fromPrep = TO_ASK.filter((item) => keys.includes(item.criterion));
    const rest = keys.filter((key) => !fromPrep.some((item) => item.criterion === key)).map((key) => NEEDS[key].ask);
    return { kind: 'say', title, lines: [...fromPrep.map((item) => item.ask), ...rest].slice(0, 3).map((say) => ({ say })) };
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
  return { kind: 'notes', title, points: recap.length ? recap : [{ text: 'Nothing has been said yet.' }] };
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
  const title = asked;
  const lower = asked.toLowerCase();
  if (OUR_PRICE.test(lower)) {
    return {
      kind: 'notes',
      title,
      points: [{ text: 'Your own price is not in this call. In the app it comes from your pricing documents, quoted and named — never a guess.' }],
    };
  }
  const best = TOPICS.map((topic) => ({ key: topic.key, hits: lower.match(topic.words)?.length ?? 0 }))
    .filter((topic) => topic.hits > 0)
    .sort((a, b) => b.hits - a.hits)[0];
  if (!best) {
    return { kind: 'notes', title, points: [{ text: 'Nothing said so far answers that. Try asking who decides, what it costs them, or when they need it.' }] };
  }
  const criterion = scorecardAfter(heard).criteria.find((c) => c.key === best.key);
  const evidence = criterion ? said(criterion) : [];
  if (evidence.length === 0) return { kind: 'notes', title, points: [{ text: `Not said yet. Try: “${NEEDS[best.key].ask}”` }] };
  return { kind: 'notes', title, points: evidence.map((piece) => quoting(piece.means, piece)) };
}
