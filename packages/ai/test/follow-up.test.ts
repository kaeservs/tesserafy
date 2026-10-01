/**
 * The follow-up email: lines that quote what was said survive, as the call
 * has it; anything else goes; and the email's text is exactly the lines that
 * were checked, between a greeting and a closing.
 */
import { describe, expect, it } from 'vitest';
import { followUpText, resolveFollowUp } from '../src/tiers/t3-follow-up';

const segments = [
  { id: 's1', speaker: 'Tom', startMs: 0, text: 'Most of Friday. Call it six hours each, so twelve hours a week between them.' },
  { id: 's2', speaker: 'Maya', startMs: 9_000, text: 'I will send over the security documents by Friday.' },
];
const line = (kind: 'recap' | 'next_step', text: string, quote: string, segment_id = 's1') => ({ kind, text, quote, segment_id });

describe('the follow-up email', () => {
  it('keeps lines whose quote is in their segment, as the call has it, recaps before next steps', () => {
    const { draft, dropped } = resolveFollowUp(
      {
        subject: ' Following up on Friday reporting ',
        greeting: 'Hi Tom,',
        opening: 'Thanks for the time today.',
        lines: [
          line('next_step', 'I will send the security documents by Friday.', 'send over the security  documents', 's2'),
          line('recap', 'Reporting takes twelve hours a week.', 'twelve hours a week'),
          line('recap', 'You have budget approved.', 'budget is approved'),
          line('next_step', 'Wrong segment.', 'twelve hours a week', 's2'),
          line('recap', 'Unknown segment.', 'anything', 's9'),
        ],
        closing: 'Best, Maya',
      },
      segments,
    );
    expect(dropped).toBe(3);
    expect(draft.subject).toBe('Following up on Friday reporting');
    expect(draft.lines).toEqual([
      { kind: 'recap', text: 'Reporting takes twelve hours a week.', segmentId: 's1', quote: 'twelve hours a week' },
      { kind: 'next_step', text: 'I will send the security documents by Friday.', segmentId: 's2', quote: 'send over the security documents' },
    ]);
  });

  it('caps the recap at five and the next steps at four', () => {
    const many = Array.from({ length: 8 }, () => line('recap', 'R', 'twelve hours'));
    const steps = Array.from({ length: 8 }, () => line('next_step', 'S', 'security documents', 's2'));
    const { draft } = resolveFollowUp({ subject: 's', greeting: '', opening: '', lines: [...many, ...steps], closing: '' }, segments);
    expect(draft.lines.filter((l) => l.kind === 'recap')).toHaveLength(5);
    expect(draft.lines.filter((l) => l.kind === 'next_step')).toHaveLength(4);
  });

  it('reads as an email: greeting, opening, what was heard, next steps, closing', () => {
    expect(
      followUpText({
        subject: 'x',
        greeting: 'Hi Tom,',
        opening: 'Thanks for the time today.',
        lines: [
          { kind: 'recap', text: 'Reporting takes twelve hours a week.', segmentId: 's1', quote: 'q' },
          { kind: 'next_step', text: 'I will send the security documents by Friday.', segmentId: 's2', quote: 'q' },
        ],
        closing: 'Best,\nMaya',
      }),
    ).toBe(
      'Hi Tom,\n\nThanks for the time today.\n\nWhat I heard:\n- Reporting takes twelve hours a week.\n\nNext steps:\n- I will send the security documents by Friday.\n\nBest,\nMaya',
    );
  });
});
