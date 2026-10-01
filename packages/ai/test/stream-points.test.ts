import { describe, expect, it } from 'vitest';
import { PointStream } from '../src/tiers/stream-points';

const answer = JSON.stringify({
  points: [
    { text: 'Ask what {broke} first.', quote: 'nothing "stuck" here', segment_id: 'u2' },
    { text: 'Confirm the CFO [sign-off].', quote: 'over twenty thousand', segment_id: 'u4' },
  ],
});

describe('points out of a streaming answer', () => {
  it('hands back each point the moment it is whole, however the text is split', () => {
    for (const size of [1, 3, 7, 50, answer.length]) {
      const stream = new PointStream();
      const seen: unknown[] = [];
      const firstAt: number[] = [];
      for (let i = 0; i < answer.length; i += size) {
        const got = stream.push(answer.slice(i, i + size));
        if (got.length > 0) firstAt.push(i);
        seen.push(...got);
      }
      expect(seen).toEqual(JSON.parse(answer).points);
      // The first point comes out before the answer is finished.
      if (size < answer.length) expect(firstAt[0]).toBeLessThan(answer.length - size);
    }
  });

  it('is not fooled by braces, brackets or escaped quotes inside the text', () => {
    const stream = new PointStream();
    expect(stream.push('{"points":[{"text":"a } b ] c","quote":"say \\"{\\"","segment_id":""}')).toEqual([
      { text: 'a } b ] c', quote: 'say "{"', segment_id: '' },
    ]);
  });

  it('gives nothing for an answer with no points', () => {
    expect(new PointStream().push('{"points":[]}')).toEqual([]);
  });
});
