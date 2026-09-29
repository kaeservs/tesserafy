/**
 * The sample call. Pinned: its times run forward (a quote's link lands where
 * it was said), it survives the importer's own checks, and it never reaches
 * budget — the gap the first scorecard anyone sees is meant to show.
 */
import { parseTurns, redactSegments, toSegments } from '@tesserafy/ingest';
import { describe, expect, it } from 'vitest';
import { sampleTurns } from '@/lib/sample-call';

describe('sample call', () => {
  const turns = sampleTurns();

  it('runs forward in time, one turn after another', () => {
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i]!.startMs).toBeGreaterThan(turns[i - 1]!.startMs);
      expect(turns[i - 1]!.endMs).toBe(turns[i]!.startMs);
    }
  });

  it('passes the same checks as an uploaded transcript, and nothing in it is masked', () => {
    expect(() => parseTurns(turns)).not.toThrow();
    const { counts } = redactSegments(toSegments(turns));
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });

  it('never mentions budget, so the first scorecard shows a gap', () => {
    expect(turns.some((turn) => /budget|pricing|price|afford|sign off on/i.test(turn.text))).toBe(false);
  });
});
