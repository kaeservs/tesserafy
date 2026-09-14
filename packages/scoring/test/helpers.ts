import { defineCriteriaSet, type DetectorEvent, type EvidenceSpan } from '../src/index';

/** A small discovery-call scorecard with unequal weights. */
export const discovery = defineCriteriaSet({
  engagementType: 'discovery',
  version: 1,
  criteria: [
    { key: 'problem', label: 'Customer described a concrete problem', weight: 2 },
    { key: 'impact', label: 'Impact of the problem quantified', weight: 1 },
    { key: 'current_solution', label: 'Current workaround identified', weight: 1 },
  ],
});

export function span(segment: string, startMs = 1000, quote = `quote from ${segment}`): EvidenceSpan {
  return { segmentId: segment, startMs, endMs: startMs + 4000, quote };
}

export function evidence(
  criterionKey: string,
  confidence: number,
  s: EvidenceSpan = span('seg-1'),
): DetectorEvent {
  return { kind: 'evidence', criterionKey, confidence, span: s };
}

export function contradiction(
  criterionKey: string,
  confidence: number,
  s: EvidenceSpan = span('seg-neg'),
): DetectorEvent {
  return { kind: 'contradiction', criterionKey, confidence, span: s };
}

/** mulberry32 — a seeded PRNG, so property failures reproduce exactly. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
