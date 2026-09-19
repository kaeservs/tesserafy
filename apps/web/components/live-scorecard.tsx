'use client';

import { apply, initialState, score, type DetectorEvent } from '@tesserafy/scoring';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DISCOVERY_CRITERIA, DISCOVERY_SCORECARD } from '@/lib/criteria';

/**
 * The live path, browser first.
 *
 * A transcript is replayed one utterance at a time. Each step sends a rolling
 * window to T1 and folds the returned evidence into the scorecard with the
 * same pure function the Electron overlay will use — the model never returns a
 * score, and this page could not display one if it tried.
 *
 * The clock is part of the page rather than a separate benchmark: utterance to
 * visible score is the number P6 is judged on, so it is measured where the
 * user would feel it, including the network, and shown whether or not it
 * flatters us. Spike S3 measured ~1.4 s of model time alone against a 700 ms
 * budget, so these figures are expected to miss; a page that hid that would be
 * worse than useless.
 */

export interface PlayableSegment {
  id: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

/** Utterances of context sent with each step. */
const WINDOW_SIZE = 3;
const AUTOPLAY_MS = 2500;

interface Measurement {
  utterance: number;
  totalMs: number;
  modelMs: number;
}

function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
}

export function LiveScorecard({ segments }: { segments: PlayableSegment[] }) {
  const [played, setPlayed] = useState(0);
  const [state, setState] = useState(() => initialState(DISCOVERY_SCORECARD));
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const step = useCallback(async () => {
    // One request at a time: overlapping calls would interleave their evidence
    // and make the measured latency meaningless.
    if (inFlight.current) return;
    const next = played + 1;
    if (next > segments.length) {
      setPlaying(false);
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    setPlayed(next);

    const window = segments.slice(Math.max(0, next - WINDOW_SIZE), next);
    const startedAt = performance.now();

    try {
      const response = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ criteria: DISCOVERY_CRITERIA, window }),
      });
      if (!response.ok) {
        throw new Error(`detect failed: ${response.status}`);
      }
      const body = (await response.json()) as {
        events: DetectorEvent[];
        usage: { durationMs: number };
      };

      // Latching state means replaying the same evidence is harmless, so a
      // window overlapping its predecessor cannot double-count anything.
      setState((current) => body.events.reduce(apply, current));
      setMeasurements((current) => [
        ...current,
        {
          utterance: next,
          totalMs: Math.round(performance.now() - startedAt),
          modelMs: body.usage.durationMs,
        },
      ]);
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : 'detection failed');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [played, segments]);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => void step(), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, step, measurements.length]);

  const card = score(state);
  const totals = measurements.map((m) => m.totalMs);
  const models = measurements.map((m) => m.modelMs);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => void step()} disabled={busy || played >= segments.length}>
          Next utterance
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={played >= segments.length}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setPlayed(0);
            setState(initialState(DISCOVERY_SCORECARD));
            setMeasurements([]);
            setError(null);
          }}
        >
          Reset
        </button>
        <span className="muted">
          {played} / {segments.length} utterances
        </span>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </p>
      )}

      <section aria-labelledby="score-heading" style={{ marginTop: '1.25rem' }}>
        <h2 id="score-heading" style={{ marginBottom: '0.25rem' }}>
          {Math.round(card.score)}
          <span className="muted" style={{ fontSize: '1rem', fontWeight: 400 }}>
            {' '}
            / 100
          </span>
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {card.earnedWeight} of {card.totalWeight} criteria confirmed
        </p>

        <ul className="signals">
          {card.criteria.map((criterion) => (
            <li key={criterion.key} className="signal">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>{criterion.label}</span>
                <span className={criterion.status === 'confirmed' ? undefined : 'muted'}>
                  {criterion.status}
                </span>
              </div>
              {criterion.evidence.length > 0 && (
                <ul className="evidence">
                  {criterion.evidence.map((recorded) => (
                    <li key={`${recorded.span.segmentId}-${recorded.seq}`} className="muted">
                      “{recorded.span.quote}”
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="latency-heading">
        <h2 id="latency-heading">Latency</h2>
        {measurements.length === 0 ? (
          <p className="muted">Play the transcript to measure utterance to visible score.</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <td>utterance → visible score</td>
                <td>
                  p50 {percentile(totals, 0.5)} ms · p95 {percentile(totals, 0.95)} ms
                </td>
              </tr>
              <tr>
                <td className="muted">of which model</td>
                <td className="muted">
                  p50 {percentile(models, 0.5)} ms · p95 {percentile(models, 0.95)} ms
                </td>
              </tr>
              <tr>
                <td className="muted">budget (ADR 0002)</td>
                <td className="muted">1300 ms</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
