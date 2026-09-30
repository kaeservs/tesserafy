/**
 * What a company taught the AI, as the text each tier sees. Pinned: no
 * guidance leaves every prompt exactly as it was (so the eval harness still
 * measures the base prompt); examples and instructions for a criterion the
 * scorecard does not have are left out; guided results say so.
 */
import { describe, expect, it } from 'vitest';
import { renderInstructions, renderScoringGuidance, type Guidance } from '../src/tiers/guidance';
import { systemPrompt } from '../src/tiers/t1-detect';

const criteria = [
  { key: 'budget_indicated', label: 'Budget indicated', definition: 'The customer names a budget.' },
  { key: 'timeline_stated', label: 'Timeline stated', definition: 'The customer names a date.' },
];
const keys = new Set(criteria.map((c) => c.key));

const taught: Guidance = {
  purpose: 'sales',
  instructions: [
    { criterionKey: 'budget_indicated', text: 'Approved headcount counts as budget.' },
    { criterionKey: 'not_on_this_scorecard', text: 'Ignore me.' },
  ],
  examples: [
    { criterionKey: 'budget_indicated', quote: 'Headcount for this is already approved', counts: true, reason: 'Approved headcount is budget for us.' },
    { criterionKey: 'timeline_stated', quote: 'Let us talk again next week', counts: false, reason: 'Scheduling the next call is not a timeline.' },
  ],
};

describe('scoring guidance', () => {
  it('leaves the detector prompt exactly as it was when nothing was taught', () => {
    const base = systemPrompt(criteria);
    expect(systemPrompt(criteria, 'full', null)).toBe(base);
    expect(systemPrompt(criteria, 'full', { instructions: [], examples: [], purpose: null })).toBe(base);
    expect(systemPrompt(criteria, 'full', { instructions: [], examples: [], purpose: 'other' })).toBe(base);
  });

  it('adds the call type, instructions and judged examples between the criteria and the rules', () => {
    const prompt = systemPrompt(criteria, 'full', taught);
    const at = (text: string) => prompt.indexOf(text);
    expect(at('These are sales calls')).toBeGreaterThan(at('Criteria:'));
    expect(at('budget_indicated: Approved headcount counts as budget.')).toBeGreaterThan(0);
    expect(at('budget_indicated: Approved headcount is budget for us. So words like "Headcount for this is already approved" are evidence for it.')).toBeGreaterThan(0);
    expect(at('timeline_stated: Scheduling the next call is not a timeline. So words like "Let us talk again next week" are not evidence for it.')).toBeGreaterThan(0);
    expect(at('Rules:')).toBeGreaterThan(at('are not evidence for it'));
  });

  it('leaves out what is about a criterion this scorecard does not have', () => {
    expect(renderScoringGuidance(taught, keys)).not.toContain('Ignore me.');
  });
});

describe('instructions for other features', () => {
  it('is nothing without guidance, and the call type plus instructions with it', () => {
    expect(renderInstructions(null)).toBe('');
    const text = renderInstructions({ purpose: 'support', instructions: [{ criterionKey: null, text: 'Name who owns each fix.' }], examples: [] });
    expect(text).toContain('These are support calls');
    expect(text).toContain('- Name who owns each fix.');
  });
});

describe('results marked not right', () => {
  const rejected: Guidance = {
    instructions: [],
    examples: [],
    rejected: [
      { result: 'Have a good weekend', quote: 'have a good weekend', reason: 'A pleasantry, not a commitment.' },
      { result: 'What is the budget?', quote: null, reason: 'Too blunt to open with.' },
    ],
  };

  it('counts as guidance, so a guided result says so', async () => {
    const { guidanceIsEmpty } = await import('../src/index');
    expect(guidanceIsEmpty(rejected)).toBe(false);
    expect(guidanceIsEmpty({ instructions: [], examples: [], rejected: [] })).toBe(true);
  });

  it('leads with the reason as the rule, then what was written and the words it came from', () => {
    const text = renderInstructions(rejected);
    expect(text).toContain('- A pleasantry, not a commitment. (You had written: "Have a good weekend", from the words "have a good weekend".)');
    expect(text).toContain('- Too blunt to open with. (You had written: "What is the budget?".)');
  });

  it('keeps only the newest, so a long history cannot crowd out the call', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ result: `r${i}`, quote: null, reason: `reason ${i}` }));
    const text = renderInstructions({ instructions: [], examples: [], rejected: many });
    expect(text).not.toContain('reason 9.');
    expect(text).toContain('reason 10');
    expect(text).toContain('reason 29');
  });
});
