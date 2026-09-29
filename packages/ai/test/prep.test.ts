/**
 * The pre-call brief keeps only what it can show: a point about the person
 * only with a quote that is in the pasted profile, a question only for a
 * criterion on the scorecard.
 */
import { describe, expect, it } from 'vitest';
import { resolvePrep } from '../src/tiers/t3-prep';

const PROFILE = `Head of Operations at Harbor & Pine Logistics.
Twelve years in freight, the last four running carrier relationships.`;

describe('resolvePrep', () => {
  it('keeps points whose quote is in the profile, however the copy spaced it', () => {
    const brief = resolvePrep(
      {
        about: [
          { point: 'Runs operations.', quote: 'Head of Operations at  Harbor & Pine Logistics' },
          { point: 'Long in freight.', quote: 'twelve years in freight' },
          { point: 'Went to Stanford.', quote: 'Stanford University' },
        ],
        questions: [],
        open_with: '',
      },
      PROFILE,
      new Set(),
    );
    expect(brief.about.map((item) => item.point)).toEqual(['Runs operations.', 'Long in freight.']);
    expect(brief.dropped).toBe(1);
    expect(brief.openWith).toBeNull();
  });

  it('says nothing about the person when nothing was pasted', () => {
    const brief = resolvePrep({ about: [{ point: 'Anything.', quote: 'Anything' }], questions: [], open_with: 'Hi' }, null, new Set());
    expect(brief.about).toEqual([]);
  });

  it('keeps questions only for criteria on the scorecard, at most five', () => {
    const question = (key: string) => ({ criterion_key: key, ask: ` Ask about ${key}? `, why: 'because' });
    const brief = resolvePrep(
      { about: [], questions: ['budget', 'made_up', 'timeline', 'budget', 'pain', 'timeline', 'budget'].map(question), open_with: '' },
      PROFILE,
      new Set(['budget', 'timeline', 'pain']),
    );
    expect(brief.questions).toHaveLength(5);
    expect(brief.questions[0]).toEqual({ criterionKey: 'budget', ask: 'Ask about budget?', why: 'because' });
    expect(brief.questions.some((q) => q.criterionKey === 'made_up')).toBe(false);
  });
});
