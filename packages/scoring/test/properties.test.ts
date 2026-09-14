/**
 * The P2 gate as properties over generated detector sequences:
 *
 *   the score never goes down, except on an explicit contradiction.
 *
 * Sequences come from a seeded PRNG. A failure names its seed; rerun with
 * that seed to reproduce it exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  apply,
  initialState,
  replay,
  score,
  type CriterionStatus,
  type DetectorEvent,
} from '../src/index';
import { discovery, rng, span } from './helpers';

const SEQUENCES = 500;
const EVENTS_PER_SEQUENCE = 60;
const KEYS = discovery.criteria.map((c) => c.key);

function generate(seed: number, contradictionRate: number): DetectorEvent[] {
  const random = rng(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

  return Array.from({ length: EVENTS_PER_SEQUENCE }, (): DetectorEvent => {
    const criterionKey = pick(KEYS);
    // Few segments, so duplicates and same-segment spans happen often.
    const s = span(`seg-${Math.floor(random() * 6)}`, Math.floor(random() * 3) * 1000);
    const confidence = Math.round(random() * 100) / 100;
    return random() < contradictionRate
      ? { kind: 'contradiction', criterionKey, confidence, span: s }
      : { kind: 'evidence', criterionKey, confidence, span: s };
  });
}

const ALLOWED: Record<CriterionStatus, readonly CriterionStatus[]> = {
  unobserved: ['candidate', 'confirmed'],
  candidate: ['confirmed', 'contradicted'],
  confirmed: ['contradicted'],
  contradicted: ['confirmed'],
};

describe('properties over generated sequences', () => {
  it('evidence alone never lowers the score', () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      let state = initialState(discovery);
      let previous = 0;
      for (const event of generate(seed, 0)) {
        state = apply(state, event);
        const current = score(state).score;
        expect(current, `seed ${seed}`).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('with contradictions mixed in, the score drops only on a contradiction event', () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      let state = initialState(discovery);
      let previous = 0;
      for (const event of generate(seed, 0.2)) {
        state = apply(state, event);
        const current = score(state).score;
        if (current < previous) {
          expect(event.kind, `seed ${seed}`).toBe('contradiction');
        }
        previous = current;
      }
    }
  });

  it('confirmed is left only through a contradiction', () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const { transitions } = replay(discovery, generate(seed, 0.2));
      for (const t of transitions.filter((t) => t.from === 'confirmed')) {
        expect(t.cause, `seed ${seed}`).toBe('contradiction');
      }
    }
  });

  it('every transition follows an allowed edge and cites at least one quoted span', () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const { transitions } = replay(discovery, generate(seed, 0.2));
      for (const t of transitions) {
        expect(ALLOWED[t.from], `seed ${seed}: ${t.from} -> ${t.to}`).toContain(t.to);
        expect(t.spans.length, `seed ${seed}`).toBeGreaterThan(0);
        for (const r of t.spans) expect(r.span.quote.length).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: the same events always give the same scorecard', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const events = generate(seed, 0.2);
      expect(score(replay(discovery, events)), `seed ${seed}`).toEqual(
        score(replay(discovery, events)),
      );
    }
  });
});
