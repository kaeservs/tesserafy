/**
 * The overlay's on-demand help keeps the product's rule: what it says about
 * the call quotes the call. Recap, "what to say" and follow-ups must quote;
 * an answer to a typed question may be plain advice; a quote that is not in
 * the segment it names takes its point with it.
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_MAX, resolveAssist } from '../src/tiers/t2-assist';

const transcript = [
  { id: 's1', speaker: 'Dana', text: 'Month-end close takes us three days, and finance hates it.' },
  { id: 's2', speaker: 'Dana', text: 'What does it cost for a team of twelve?' },
];
const point = (text: string, quote = '', segment_id = '') => ({ text, quote, segment_id });

describe('what the overlay may say', () => {
  it('keeps a point whose quote is in the segment it names, as the call has it', () => {
    const { points, dropped } = resolveAssist('recap', { points: [point('Close takes three days.', 'three days, and finance hates it', 's1')] }, transcript);
    expect(dropped).toBe(0);
    expect(points).toEqual([{ text: 'Close takes three days.', quote: 'three days, and finance hates it', segmentId: 's1', document: null }]);
  });

  it('drops a point quoting words the call did not say, or quoting the wrong segment', () => {
    const { points, dropped } = resolveAssist(
      'recap',
      { points: [point('Budget approved.', 'the budget is approved', 's1'), point('Cost.', 'What does it cost', 's1')] },
      transcript,
    );
    expect(points).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it('requires a quote for recap, what to say and follow-ups, not for an answer to a question', () => {
    expect(resolveAssist('say', { points: [point('Offer a demo.')] }, transcript).points).toHaveLength(0);
    expect(resolveAssist('followups', { points: [point('Ask about timing.')] }, transcript).points).toHaveLength(0);
    expect(resolveAssist('ask', { points: [point('Lead with the ROI calculator.')] }, transcript).points).toEqual([
      { text: 'Lead with the ROI calculator.', quote: null, segmentId: null, document: null },
    ]);
  });

  it('gives at most what each mode allows', () => {
    const many = { points: Array.from({ length: 6 }, (_, i) => point(`Q${i}?`, 'finance hates it', 's1')) };
    expect(resolveAssist('say', many, transcript).points).toHaveLength(ASSIST_MAX.say);
    expect(resolveAssist('followups', many, transcript).points).toHaveLength(ASSIST_MAX.followups);
  });

  it('answers from the company\'s knowledge only in its own words, and names the document', () => {
    const knowledge = [{ id: 'k1', title: 'Pricing sheet', text: 'Pro is $20 a seat a month. Rollout takes two weeks.' }];
    const { points, dropped } = resolveAssist(
      'ask',
      {
        points: [
          point('Rollout is two weeks.', 'Rollout takes two weeks', 'k1'),
          point('It is $15 a seat.', 'Pro is $15 a seat', 'k1'),
        ],
      },
      transcript,
      knowledge,
    );
    expect(points).toEqual([{ text: 'Rollout is two weeks.', quote: 'Rollout takes two weeks', segmentId: null, document: 'Pricing sheet' }]);
    expect(dropped).toBe(1);
  });
});
