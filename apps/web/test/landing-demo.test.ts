/**
 * The landing page's overlay demo says what the product says: every point
 * about the call quotes it, and the score is the scoring engine's. These hold
 * the sample call to the same rules — a demo that made up a quote would be
 * the landing page breaking invariant 5 in public.
 */
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_CALL,
  TO_ASK,
  ask,
  assist,
  sayNextAfter,
  scorecardAfter,
  suggestionAfter,
  talkShares,
  type Answer,
  type Point,
} from '@/components/landing/sample-call';

const MODES = ['assist', 'followups', 'recap'] as const;
const QUESTIONS = [
  'Who decides?',
  'What is their budget?',
  'How much does it cost them?',
  'When do they need it live?',
  'Why is month-end a problem?',
  'What is the next step?',
  'What is our price?',
  'How much do we charge?',
  'Tell me a joke',
];

/** The points of an answer that is notes, as the box's answers are. */
function notes(answer: Answer | null): readonly Point[] {
  expect(answer?.kind).toBe('notes');
  return answer?.kind === 'notes' ? answer.points : [];
}

/** What the customer has said in the first `heard` lines. */
function customerSaid(heard: number): string[] {
  return SAMPLE_CALL.slice(0, heard)
    .filter((line) => line.side === 'them')
    .map((line) => line.text);
}

function quotesOnlyWhatWasSaid(answer: Answer, heard: number): void {
  const said = customerSaid(heard);
  if (answer.kind === 'say') {
    // A line to say shows the customer's line it answers whole, as they said it.
    for (const line of answer.lines) {
      if (line.them === undefined) continue;
      expect(said, `“${line.them}” after ${heard} lines`).toContain(line.them);
    }
    return;
  }
  for (const point of answer.points) {
    if (point.quote === undefined) continue;
    expect(said.some((text) => text.includes(point.quote!)), `“${point.quote}” after ${heard} lines`).toBe(true);
  }
}

describe('the landing page sample call', () => {
  it('finds every piece of evidence word for word in the line it comes from', () => {
    for (const line of SAMPLE_CALL) {
      if (line.evidence) {
        expect(line.side).toBe('them');
        expect(line.text).toContain(line.evidence.quote);
      }
      if (line.suggests) expect(line.text).toContain(line.suggests.because);
    }
  });

  it('quotes only what has already been said, at every point of the call', () => {
    for (let heard = 0; heard <= SAMPLE_CALL.length; heard++) {
      for (const mode of MODES) quotesOnlyWhatWasSaid(assist(mode, heard), heard);
      for (const question of QUESTIONS) {
        const answer = ask(question, heard);
        if (answer) quotesOnlyWhatWasSaid(answer, heard);
      }
      const suggestion = suggestionAfter(heard);
      if (suggestion) expect(customerSaid(heard).some((text) => text.includes(suggestion.because))).toBe(true);
      const next = sayNextAfter(heard);
      if (next.them !== null) expect(customerSaid(heard)).toContain(next.them);
    }
  });

  it('scores with the engine, never goes down, and is full by the end', () => {
    let previous = -1;
    for (let heard = 0; heard <= SAMPLE_CALL.length; heard++) {
      const card = scorecardAfter(heard);
      expect(card.score).toBeGreaterThanOrEqual(previous);
      previous = card.score;
    }
    expect(scorecardAfter(0).score).toBe(0);
    expect(scorecardAfter(SAMPLE_CALL.length).score).toBe(100);
  });

  it('shows a criterion mentioned once as a candidate, one mention short', () => {
    const once = SAMPLE_CALL.findIndex((line) => line.evidence?.quote === 'We pay overtime for most of it') + 1;
    const cost = scorecardAfter(once).criteria.find((criterion) => criterion.key === 'cost');
    expect(cost?.status).toBe('candidate');
    expect(cost?.shortfall).toMatchObject({ segments: 1, segmentsNeeded: 2 });
    expect(scorecardAfter(once + 1).criteria.find((criterion) => criterion.key === 'cost')?.status).toBe('confirmed');
  });

  it('answers who decides from the words that say so, and only once they are said', () => {
    const priya = SAMPLE_CALL.findIndex((line) => line.evidence?.criterion === 'decision_maker');
    expect(notes(ask('Who decides?', priya))).toEqual([{ text: expect.stringMatching(/^Not said yet/) }]);
    expect(notes(ask('Who decides?', priya + 1))[0]?.quote).toBe('run it past our CFO, Priya');
  });

  it('never gives our own price: it is not something the customer said', () => {
    for (const question of ['What is our price?', 'Is there a discount?', 'How much do we charge?']) {
      const points = notes(ask(question, SAMPLE_CALL.length));
      expect(points.every((point) => point.quote === undefined)).toBe(true);
      expect(points[0]?.text).toMatch(/not in this call/);
    }
  });

  it('asks about the customer’s cost as the customer’s cost, not our price', () => {
    expect(notes(ask('How much does it cost them?', SAMPLE_CALL.length))[0]?.quote).toBe('about eight thousand a month back');
  });

  it('crosses a prep question off once its criterion is confirmed', () => {
    const done = scorecardAfter(SAMPLE_CALL.length).criteria.filter((criterion) => criterion.status === 'confirmed');
    for (const item of TO_ASK) expect(done.some((criterion) => criterion.key === item.criterion)).toBe(true);
  });

  it('puts what to say next first: the prep until a suggestion, then the suggestion', () => {
    expect(sayNextAfter(0)).toEqual({ say: TO_ASK[0]!.ask, them: null, from: 'prep' });
    const pain = SAMPLE_CALL.findIndex((line) => line.evidence?.criterion === 'pain') + 1;
    expect(sayNextAfter(pain)).toMatchObject({ them: SAMPLE_CALL[pain - 1]!.text, from: 'live' });
    expect(sayNextAfter(SAMPLE_CALL.length).from).toBe('live');
  });

  it('gives the words to say, never advice about saying them', () => {
    const advice = /^(ask|offer|confirm|propose|put|find|pin|open)\b|\b(is confirmed|build on it|still open|mentioned once|covered)\b/i;
    for (let heard = 0; heard <= SAMPLE_CALL.length; heard++) {
      expect(sayNextAfter(heard).say).not.toMatch(advice);
      for (const mode of ['assist', 'followups'] as const) {
        const answer = assist(mode, heard);
        expect(answer.kind).toBe('say');
        if (answer.kind === 'say') for (const line of answer.lines) expect(line.say).not.toMatch(advice);
      }
    }
  });

  it('answers AI Assist with one line, to the customer’s last words', () => {
    const lastTheirs = SAMPLE_CALL.findLastIndex((line) => line.side === 'them');
    const answer = assist('assist', SAMPLE_CALL.length);
    expect(answer).toMatchObject({ kind: 'say', title: 'AI Assist', lines: [{ them: SAMPLE_CALL[lastTheirs]!.text }] });
    expect(assist('assist', 0)).toMatchObject({ kind: 'say', lines: [{ say: TO_ASK[0]!.ask }] });
    expect(assist('followups', 0)).toMatchObject({ kind: 'say', title: 'To Ask', lines: TO_ASK.map((item) => ({ say: item.ask })) });
  });

  it('splits the talking by words, both sides adding up to all of it', () => {
    const shares = talkShares(SAMPLE_CALL.length);
    expect(shares.me + shares.them).toBeCloseTo(1);
    expect(shares.them).toBeGreaterThan(shares.me);
    expect(talkShares(0)).toEqual({ me: 0, them: 0, words: 0 });
  });
});
