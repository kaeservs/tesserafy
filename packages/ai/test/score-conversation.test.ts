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
  SCORE_WINDOW_SIZE,
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

describe('windowsOf', () => {
  it('overlaps by all but one utterance', () => {
    const windows = windowsOf(segments(5));

    expect(windows.map((w) => w.map((s) => s.id))).toEqual([
      ['s0', 's1', 's2'],
      ['s1', 's2', 's3'],
      ['s2', 's3', 's4'],
    ]);
  });

  it('never repeats the tail once the last utterance is covered', () => {
    const windows = windowsOf(segments(3));

    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(SCORE_WINDOW_SIZE);
  });

  it('keeps a call shorter than one window as a single window', () => {
    expect(windowsOf(segments(2)).map((w) => w.length)).toEqual([2]);
  });

  it('has nothing to say about an empty call', () => {
    expect(windowsOf([])).toEqual([]);
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

  it('stores a span seen by three overlapping windows once, at its strongest', async () => {
    const result = await scanWindows(windowsOf(segments(5)), {
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
    const result = await scanWindows(windowsOf(segments(5)), {
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
    const serial = await scanWindows(windowsOf(segments(9)), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect(() => 0.8),
      concurrency: 1,
    });
    const parallel = await scanWindows(windowsOf(segments(9)), {
      client: {} as never,
      criteria: [],
      detect: fakeDetect(() => 0.8),
      concurrency: 6,
    });

    expect(parallel.events).toEqual(serial.events);
    expect(parallel.calls).toBe(serial.calls);
  });
});
