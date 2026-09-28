/**
 * A draft scorecard's rules, as the editor and the trial route apply them.
 *
 * They repeat `publish_scorecard`'s, so what matters is that they agree with
 * it: a draft the editor calls publishable and the database refuses is a
 * button that does nothing useful.
 */
import { describe, expect, it } from 'vitest';
import { draftProblems, keyFor, nameFor, parseDraft, type DraftCriterion } from '@/lib/scorecard-draft';

const good: DraftCriterion[] = [
  {
    key: 'agenda_agreed',
    label: 'Agenda agreed',
    definition: 'The seller and the customer agree what the demo will cover.',
    weight: 1,
  },
  {
    key: 'next_step_booked',
    label: 'Next step booked',
    definition: 'A dated next meeting or trial is agreed before the call ends.',
    weight: 2,
  },
];

describe('keyFor and nameFor', () => {
  it('turns a name a person typed into what the database accepts', () => {
    expect(keyFor('Next step booked')).toBe('next_step_booked');
    expect(keyFor('  Pain — quantified! ')).toBe('pain_quantified');
    expect(nameFor('Product demo')).toBe('product-demo');
  });

  it('never produces a key that starts with a digit', () => {
    expect(keyFor('3rd call booked')).toBe('c_3rd_call_booked');
    expect(nameFor('2026 renewals')).toBe('');
  });

  it('gives nothing for a name with too little in it', () => {
    expect(keyFor('?')).toBe('');
    expect(keyFor('a')).toBe('');
  });
});

describe('draftProblems', () => {
  it('passes a good draft', () => {
    expect(draftProblems('demo', good)).toEqual([]);
  });

  it('refuses a template name', () => {
    expect(draftProblems('discovery', good, ['discovery'])).toEqual([
      '"discovery" is the name of a Tesserafy template. Choose another.',
    ]);
  });

  it('refuses a name that is not a slug', () => {
    expect(draftProblems('', good)).toHaveLength(1);
    expect(draftProblems('Demo', good)).toHaveLength(1);
  });

  it('needs two to twelve criteria', () => {
    expect(draftProblems('demo', good.slice(0, 1))).toContain('A scorecard has 2 to 12 criteria.');
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ ...good[0]!, key: `c_${i}x` }));
    expect(draftProblems('demo', thirteen)).toContain('A scorecard has 2 to 12 criteria.');
  });

  it('refuses two criteria with the same name', () => {
    expect(draftProblems('demo', [good[0]!, { ...good[1]!, key: 'agenda_agreed' }])).toEqual([
      'Next step booked: another criterion has the same name.',
    ]);
  });

  it('refuses a description too short to listen for', () => {
    const problems = draftProblems('demo', [good[0]!, { ...good[1]!, definition: 'Booked.' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Next step booked: describe what counts/);
  });

  it('refuses a weight outside what the database takes', () => {
    expect(draftProblems('demo', [good[0]!, { ...good[1]!, weight: 10 }])).toEqual([
      'Next step booked: weight is between 0.5 and 3.',
    ]);
  });
});

describe('parseDraft', () => {
  it('reads a well-formed body and trims it', () => {
    expect(parseDraft({ name: ' demo ', criteria: [{ ...good[0]!, label: ' Agenda agreed ' }] })).toEqual({
      name: 'demo',
      criteria: [good[0]],
    });
  });

  it('refuses anything else rather than coercing it', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ name: 'demo' })).toBeNull();
    expect(parseDraft({ name: 'demo', criteria: [{ ...good[0]!, weight: '2' }] })).toBeNull();
    expect(parseDraft({ name: 'demo', criteria: Array.from({ length: 13 }, () => good[0]) })).toBeNull();
  });
});
