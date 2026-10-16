/**
 * The three buttons: going back to an answer shows the one kept, pressing the
 * one on screen asks again, and words to say sit beside the line they answer.
 */
import { describe, expect, it } from 'vitest';
import {
  TO_ASK_MAX,
  isButtonMode,
  pressAction,
  replyOf,
  sinceLabel,
  theirName,
  toAskNeedsModel,
  toAskReplies,
  type AssistPoint,
} from '../src/renderer/answers';

const lines = [
  { id: 'u0', speaker: 'seller', text: 'Shall we set up time with Priya next week?' },
  { id: 'u1', speaker: 'customer', text: 'Yes, Thursday works for both of us.' },
];

function point(text: string, extra: Partial<AssistPoint> = {}): AssistPoint {
  return { text, quote: null, segmentId: null, document: null, ...extra };
}

describe('pressing a button', () => {
  it('asks for a first answer, shows the kept one when going back, and asks again for the one on screen', () => {
    expect(pressAction('say', null, false)).toBe('ask');
    expect(pressAction('say', 'followups', true)).toBe('recall');
    expect(pressAction('say', 'say', true)).toBe('ask');
    expect(pressAction('recap', 'say', false)).toBe('ask');
  });

  it('knows its three buttons and nothing else', () => {
    expect(['say', 'followups', 'recap'].every(isButtonMode)).toBe(true);
    expect(isButtonMode('assist')).toBe(false);
    expect(isButtonMode('toString')).toBe(false);
  });
});

describe('an answer’s age', () => {
  it('reads as just now, seconds, then minutes', () => {
    expect(sinceLabel(0)).toBe('just now');
    expect(sinceLabel(9_999)).toBe('just now');
    expect(sinceLabel(40_000)).toBe('40 s ago');
    expect(sinceLabel(125_000)).toBe('2 min ago');
    expect(sinceLabel(-5)).toBe('just now');
  });
});

describe('a line to say', () => {
  it('sits beside the customer’s whole line it answers', () => {
    const reply = replyOf(point('Great, I’ll send the invite.', { quote: 'Thursday works', segmentId: 'u1' }), lines);
    expect(reply).toEqual({ say: 'Great, I’ll send the invite.', them: 'Yes, Thursday works for both of us.', source: null });
  });

  it('shows what it rests on under it when that is not the customer’s line', () => {
    expect(replyOf(point('It syncs nightly.', { quote: 'nightly sync', document: 'Integrations.pdf' }), lines)).toEqual({
      say: 'It syncs nightly.',
      them: null,
      source: '“nightly sync” — Integrations.pdf',
    });
    expect(replyOf(point('As I said, next week.', { quote: 'next week', segmentId: 'u0' }), lines).them).toBeNull();
  });

  it('names the customer by the prep’s person, else as Them', () => {
    expect(theirName('Dana Whitfield')).toBe('Dana');
    expect(theirName('  ')).toBe('Them');
    expect(theirName(null)).toBe('Them');
  });
});

describe('To Ask', () => {
  it('puts the prep’s open questions first, then what the call prompted, up to three', () => {
    const replies = toAskReplies(['Who else signs off?'], [point('What does the overtime come to?'), point('When is the board review?'), point('One too many?')]);
    expect(replies.map((reply) => reply.say)).toEqual(['Who else signs off?', 'What does the overtime come to?', 'When is the board review?']);
    expect(replies).toHaveLength(TO_ASK_MAX);
  });

  it('asks the model only when the prep leaves room', () => {
    expect(toAskNeedsModel(['a', 'b', 'c'])).toBe(false);
    expect(toAskNeedsModel(['a'])).toBe(true);
    expect(toAskReplies(['a', 'b', 'c', 'd'], [])).toHaveLength(3);
  });

  it('does not repeat a question the prep already asks', () => {
    expect(toAskReplies(['Who else signs off?'], [point('who else signs off?'), point('Anything else?')]).map((r) => r.say)).toEqual([
      'Who else signs off?',
      'Anything else?',
    ]);
  });
});
