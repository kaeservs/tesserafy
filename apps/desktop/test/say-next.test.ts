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

const lines = [
  { id: 'u0', speaker: 'seller', text: 'How is month-end?' },
  { id: 'u1', speaker: 'customer', text: 'And I’d have to run it past our CFO, Priya, first.' },
];

describe('sayNext', () => {
  it('puts the live suggestion first, beside the whole line it answers', () => {
    const next = sayNext({ ask: 'Who else signs off?', because: 'run it past our CFO', segmentId: 'u1' }, questions, [], lines);
    expect(next).toEqual({ say: 'Who else signs off?', them: 'And I’d have to run it past our CFO, Priya, first.', from: 'live' });
  });

  it('shows the words it answers when the line is not to hand', () => {
    const next = sayNext({ ask: 'Who else signs off?', because: 'run it past our CFO' }, questions, [], lines);
    expect(next.them).toBe('run it past our CFO');
  });

  it('falls back to the prep’s next question the scorecard has not seen answered', () => {
    const next = sayNext(null, questions, [{ key: 'budget_indicated', status: 'confirmed' }]);
    expect(next).toEqual({ say: 'When does this need to work by?', them: null, from: 'prep' });
  });

  it('says it is listening when there is nothing to say yet', () => {
    expect(sayNext(null, [], []).from).toBe('waiting');
    const allDone = sayNext(null, questions, [
      { key: 'budget_indicated', status: 'confirmed' },
      { key: 'timeline_stated', status: 'confirmed' },
    ]);
    expect(allDone.from).toBe('waiting');
  });
});
