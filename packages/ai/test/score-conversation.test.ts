/**
 * The windowing and the dedup that both the CLI and an upload now share.
 *
 * Two copies of this used to be one bad edit away from scoring the same
 * meeting differently depending on who had uploaded it; these tests are what
 * says there is one behaviour, not what that behaviour happens to be today.
 */
import { describe, expect, it } from 'vitest';
import {
  scanWindows,
  SCORE_MAX_TOKENS,
  SCORE_STRIDE,
  SCORE_WINDOW_SIZE,
  windowCount,
  windowsOf,
  type StoredSegment,
} from '../src/scoring/score-conversation';

function segments(n: number): StoredSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    speaker: 'Customer',
    start_ms: i * 1000,
    end_ms: i * 1000 + 900,
    text: `utterance ${i}`,
  }));
}

describe('windowsOf, as the product scores a stored call', () => {
  it('scores a call of up to one window in a single call', () => {
    expect(windowsOf(segments(5)).map((w) => w.length)).toEqual([5]);
    expect(windowsOf(segments(SCORE_WINDOW_SIZE))).toHaveLength(1);
  });

  it('cuts a longer call into large windows that share two utterances', () => {
    const windows = windowsOf(segments(100));

    expect(windows.map((w) => w.length)).toEqual([48, 48, 8]);
    expect(windows.map((w) => [w[0]!.id, w.at(-1)!.id])).toEqual([
      ['s0', 's47'],
      ['s46', 's93'],
      ['s92', 's99'],
    ]);
    // Every neighbouring pair of utterances shares a window somewhere, which
    // is what keeps a complaint and its cost together across a boundary.
    for (let i = 0; i < 99; i++) {
      const ids = [`s${i}`, `s${i + 1}`];
      expect(windows.some((w) => ids.every((id) => w.some((s) => s.id === id)))).toBe(true);
    }
  });

  it('has nothing to say about an empty call', () => {
    expect(windowsOf([])).toEqual([]);
  });
});

describe('windowsOf, with the size and stride given', () => {
  it('overlaps by all but one utterance at stride 1', () => {
    expect(windowsOf(segments(5), 1, 3).map((w) => w.map((s) => s.id))).toEqual([
      ['s0', 's1', 's2'],
      ['s1', 's2', 's3'],
      ['s2', 's3', 's4'],
    ]);
  });

  it('never repeats the tail once the last utterance is covered', () => {
    expect(windowsOf(segments(3), 1, 3)).toHaveLength(1);
  });

  it('keeps a call shorter than one window as a single window', () => {
    expect(windowsOf(segments(2), 1, 3).map((w) => w.length)).toEqual([2]);
  });
});

describe('windowCount', () => {
  it('agrees with windowsOf for every length, without building the windows', () => {
    for (const n of [0, 1, 5, 47, 48, 49, 94, 95, 100, 500, 1842, 1843]) {
      expect(windowCount(n)).toBe(windowsOf(segments(n)).length);
      expect(windowCount(n, 1, 3)).toBe(windowsOf(segments(n), 1, 3).length);
    }
  });

  it('makes an hour-long meeting about a dozen calls, not five hundred', () => {
    expect(windowCount(500)).toBe(11);
    expect(windowCount(500, 1, 3)).toBe(498);
    expect(SCORE_STRIDE).toBeLessThan(SCORE_WINDOW_SIZE);
  });
});

describe('scanWindows', () => {
  /** A detector that finds the same span in every window that contains it. */
  function fakeDetect(confidenceFor: (windowIndex: number) => number) {
    let call = 0;
    return (async (window: readonly { id: string; text: string }[]) => {
      const index = call++;
      const target = window.find((segment) => segment.id === 's2');
      return {
        events: target
          ? [
              {
                kind: 'evidence' as const,
                criterionKey: 'pain_quantified',
                confidence: confidenceFor(index),
                span: { segmentId: 's2', startMs: 0, endMs: 0, quote: 'utterance 2' },
              },
            ]
          : [],
        rejected: index === 0 ? [{ reason: 'not quotable' }] : [],
        model: 'claude-haiku-4-5',
        detector: 't1-detect@test',
        usage: {} as never,
      };
    }) as never;
  }

  it('gives each window room for a large window\'s evidence', async () => {
    const caps: (number | undefined)[] = [];
    await scanWindows(windowsOf(segments(100)), {
      client: {} as never,
      criteria: [],
      detect: (async (_window: unknown, opts: { maxTokens?: number }) => {
        caps.push(opts.maxTokens);
        return { events: [], rejected: [], model: 'm', detector: 'd', usage: {} as never };
      }) as never,
    });
    expect(caps).toEqual([SCORE_MAX_TOKENS, SCORE_MAX_TOKENS, SCORE_MAX_TOKENS]);
  });

  it('stores a span seen by three overlapping windows once, at its strongest', async () => {
    const result = await scanWindows(windowsOf(segments(5), 1, 3), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect((i) => [0.6, 0.9, 0.7][i]!),
    });

    expect(result.calls).toBe(3);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.confidence).toBe(0.9);
    expect(result.events[0]?.detector).toBe('t1-detect@test');
  });

  it('counts what the detector could not quote', async () => {
    const result = await scanWindows(windowsOf(segments(5), 1, 3), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect(() => 0.8),
    });

    expect(result.rejected).toBe(1);
  });

  it('gets the same answer at any concurrency', async () => {
    // The upload path runs windows in parallel to fit a time budget. If
    // parallelism changed what was found, the same meeting would score
    // differently depending on which door it came in by.
    const serial = await scanWindows(windowsOf(segments(9), 1, 3), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect(() => 0.8),
      concurrency: 1,
    });
    const parallel = await scanWindows(windowsOf(segments(9), 1, 3), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect(() => 0.8),
      concurrency: 6,
    });

    expect(parallel.events).toEqual(serial.events);
    expect(parallel.calls).toBe(serial.calls);
  });
});
