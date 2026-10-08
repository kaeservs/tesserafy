/**
 * What the overlay puts first: the live suggestion, else the prep's next
 * unanswered question, else that it is listening — each saying where it is from.
 */
import { describe, expect, it } from 'vitest';
import { sayNext } from '../src/renderer/say-next';

const questions = [
  { key: 'budget_indicated', label: 'Budget indicated', ask: 'Is there budget set aside?' },
  { key: 'timeline_stated', label: 'Timeline stated', ask: 'When does this need to work by?' },
];

describe('sayNext', () => {
  it('puts the live suggestion first, with the words it answers to', () => {
    const next = sayNext({ ask: 'Ask who signs off.', because: 'run it past our CFO' }, questions, []);
    expect(next).toEqual({ label: 'Say next', text: 'Ask who signs off.', why: 'because they said “run it past our CFO”', waiting: false });
  });

  it('falls back to the prep’s next question the scorecard has not seen answered', () => {
    const next = sayNext(null, questions, [{ key: 'budget_indicated', status: 'confirmed' }]);
    expect(next).toMatchObject({ label: 'From your prep', text: 'When does this need to work by?', why: null });
  });

  it('says it is listening when there is nothing to say yet', () => {
    expect(sayNext(null, [], []).waiting).toBe(true);
    const allDone = sayNext(null, questions, [
      { key: 'budget_indicated', status: 'confirmed' },
      { key: 'timeline_stated', status: 'confirmed' },
    ]);
    expect(allDone).toMatchObject({ label: 'Listening', waiting: true });
  });
});
