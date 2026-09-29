import { describe, expect, it } from 'vitest';
import { questionsToAsk } from '../src/renderer/to-ask';

const questions = [
  { key: 'budget_indicated', label: 'Budget indicated', ask: 'Is there budget set aside?' },
  { key: 'timeline_stated', label: 'Timeline stated', ask: 'When does this need to work by?' },
];

describe('questionsToAsk', () => {
  it('marks a question done only once its criterion is confirmed', () => {
    const shown = questionsToAsk(questions, [
      { key: 'budget_indicated', status: 'confirmed' },
      { key: 'timeline_stated', status: 'candidate' },
    ]);
    expect(shown.map((q) => q.done)).toEqual([true, false]);
  });

  it('keeps every question open when the scorecard has heard nothing', () => {
    expect(questionsToAsk(questions, []).every((q) => !q.done)).toBe(true);
  });
});
