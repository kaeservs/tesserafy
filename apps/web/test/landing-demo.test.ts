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
  scorecardAfter,
  suggestionAfter,
  talkShares,
  type Answer,
} from '@/components/landing/sample-call';

const MODES = ['assist', 'say', 'followups', 'recap'] as const;
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

/** What the customer has said in the first `heard` lines. */
function customerSaid(heard: number): string[] {
  return SAMPLE_CALL.slice(0, heard)
    .filter((line) => line.side === 'them')
    .map((line) => line.text);
}

function quotesOnlyWhatWasSaid(answer: Answer, heard: number): void {
  const said = customerSaid(heard);
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
    expect(ask('Who decides?', priya)?.points).toEqual([{ text: expect.stringMatching(/^Not said yet/) }]);
    expect(ask('Who decides?', priya + 1)?.points[0]?.quote).toBe('run it past our CFO, Priya');
  });

  it('never gives our own price: it is not something the customer said', () => {
    for (const question of ['What is our price?', 'Is there a discount?', 'How much do we charge?']) {
      const answer = ask(question, SAMPLE_CALL.length);
      expect(answer?.points.every((point) => point.quote === undefined)).toBe(true);
      expect(answer?.points[0]?.text).toMatch(/not in this call/);
    }
  });

  it('asks about the customer’s cost as the customer’s cost, not our price', () => {
    expect(ask('How much does it cost them?', SAMPLE_CALL.length)?.points[0]?.quote).toBe('about eight thousand a month back');
  });

  it('crosses a prep question off once its criterion is confirmed', () => {
    const done = scorecardAfter(SAMPLE_CALL.length).criteria.filter((criterion) => criterion.status === 'confirmed');
    for (const item of TO_ASK) expect(done.some((criterion) => criterion.key === item.criterion)).toBe(true);
  });

  it('splits the talking by words, both sides adding up to all of it', () => {
    const shares = talkShares(SAMPLE_CALL.length);
    expect(shares.me + shares.them).toBeCloseTo(1);
    expect(shares.them).toBeGreaterThan(shares.me);
    expect(talkShares(0)).toEqual({ me: 0, them: 0, words: 0 });
  });
});
