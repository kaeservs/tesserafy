'use client';

import type { CriterionPrompt } from '@tesserafy/ai';
import { apply, initialState, score, type CriteriaSet, type DetectorEvent } from '@tesserafy/scoring';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The live path on real speech.
 *
 * Browser speech recognition stands in for streaming STT while spike S2 is
 * unanswered. It is an instrument, not the product: the audio goes to the
 * browser vendor's servers, which is unacceptable for customer conversations,
 * and S2 still has to choose something that can be run under our own terms.
 * What this buys today is every other part of the live path — endpointing, the
 * rolling window, T1, the latching scorecard — exercised on speech rather than
 * on a file, and measured.
 *
 * Endpointing is T0's job and here it is the recogniser's `isFinal`: a result
 * marked final ends an utterance. That is cruder than a real endpointer, and
 * it is the same shape, so the measurements transfer.
 */

const WINDOW_SIZE = 3;

interface Utterance {
  id: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  text: string;
}

interface Measurement {
  /** Speech started → first interim text on screen. ADR 0002 budgets 300 ms. */
  firstPartialMs: number | null;
  /** Utterance ended → scorecard reflects it. The number P6 is judged on. */
  utteranceToScoreMs: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
}

function recogniser(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
}

export function LiveMicrophone({
  prompts,
  scorecard,
}: {
  prompts: CriterionPrompt[];
  scorecard: CriteriaSet;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [speaker, setSpeaker] = useState<'customer' | 'me'>('customer');
  const [interim, setInterim] = useState('');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [state, setState] = useState(() => initialState(scorecard));
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const sessionStart = useRef<number>(0);
  const speechStart = useRef<number | null>(null);
  const firstPartial = useRef<number | null>(null);
  const window_ = useRef<Utterance[]>([]);
  const speakerRef = useRef(speaker);

  useEffect(() => {
    speakerRef.current = speaker;
  }, [speaker]);

  useEffect(() => {
    setSupported(recogniser() !== null);
  }, []);

  const detect = useCallback(
    async (utterance: Utterance, endedAt: number, partialMs: number | null) => {
      const recent = [...window_.current.slice(-WINDOW_SIZE)];
      try {
        const response = await fetch('/api/detect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ criteria: prompts, window: recent }),
        });
        if (!response.ok) throw new Error(`detect failed: ${response.status}`);
        const body = (await response.json()) as { events: DetectorEvent[] };

        setState((current) => body.events.reduce(apply, current));
        setMeasurements((current) => [
          ...current,
          {
            firstPartialMs: partialMs,
            utteranceToScoreMs: Math.round(performance.now() - endedAt),
          },
        ]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'detection failed');
      }
    },
    [prompts],
  );

  const start = useCallback(() => {
    const engine = recogniser();
    if (!engine) return;

    engine.continuous = true;
    engine.interimResults = true;
    engine.lang = 'en-GB';
    sessionStart.current = performance.now();

    engine.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const text = result[0].transcript.trim();
        if (text.length === 0) continue;

        if (!result.isFinal) {
          if (speechStart.current === null) speechStart.current = performance.now();
          if (firstPartial.current === null) {
            firstPartial.current = Math.round(performance.now() - speechStart.current);
          }
          setInterim(text);
          continue;
        }

        // Final result: the utterance is over, which is the clock start for
        // the number that matters.
        const endedAt = performance.now();
        const utterance: Utterance = {
          id: `u${window_.current.length}`,
          speaker: speakerRef.current === 'customer' ? 'customer' : 'seller',
          startMs: Math.round((speechStart.current ?? endedAt) - sessionStart.current),
          endMs: Math.round(endedAt - sessionStart.current),
          text,
        };

        window_.current = [...window_.current, utterance];
        setUtterances(window_.current);
        setInterim('');

        const partialMs = firstPartial.current;
        speechStart.current = null;
        firstPartial.current = null;

        void detect(utterance, endedAt, partialMs);
      }
    };

    engine.onerror = (event) => {
      // 'no-speech' fires on any quiet stretch; it is not a failure worth
      // shouting about mid-call.
      if (event.error !== 'no-speech') setError(`speech recognition: ${event.error}`);
    };

    engine.onend = () => {
      setListening(false);
    };

    recognition.current = engine;
    setError(null);
    engine.start();
    setListening(true);
  }, [detect]);

  const stop = useCallback(() => {
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
    setInterim('');
  }, []);

  useEffect(() => () => recognition.current?.stop(), []);

  const card = score(state);
  const partials = measurements.map((m) => m.firstPartialMs).filter((v): v is number => v !== null);
  const toScore = measurements.map((m) => m.utteranceToScoreMs);

  if (supported === false) {
    return (
      <p role="alert">
        This browser has no speech recognition. Chrome or Edge on the desktop has it; Firefox and
        Safari do not. The transcript replay at <code>/live/&lt;conversation&gt;</code> works
        everywhere and exercises the same path.
      </p>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <button type="button" onClick={listening ? stop : start}>
          {listening ? 'Stop listening' : 'Start listening'}
        </button>
        <button type="button" onClick={() => setSpeaker((s) => (s === 'customer' ? 'me' : 'customer'))}>
          Speaking: {speaker === 'customer' ? 'the customer' : 'me'}
        </button>
        <span className="muted">{utterances.length} utterances</span>
      </div>
      <p className="muted">
        Who is speaking is a toggle because diarisation is not solved here. It matters: the detector
        is told to report the customer’s words, not the seller’s.
      </p>

      {error && <p role="alert">{error}</p>}

      {/* What it is hearing, before it commits. aria-live off: interim text
          changes constantly and would flood a screen reader. */}
      <p className="interim" aria-hidden="true">
        {interim || (listening ? 'listening…' : '')}
      </p>

      <section aria-labelledby="mic-score">
        <h2 id="mic-score">Scorecard</h2>
        <p aria-live="polite">
          <span className="score">{Math.round(card.score)}</span>
          <span className="score-unit"> / 100</span>
        </p>
        <ul className="signals">
          {card.criteria.map((criterion) => (
            <li key={criterion.key} className="signal">
              <div className="criterion">
                <span>{criterion.label}</span>
                <span className={`state state-${criterion.status}`}>{criterion.status}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mic-latency">
        <h2 id="mic-latency">Latency</h2>
        {measurements.length === 0 ? (
          <p className="muted">Speak to measure it.</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <td>utterance → visible score</td>
                <td>
                  p50 {percentile(toScore, 0.5)} ms · p95 {percentile(toScore, 0.95)} ms
                </td>
              </tr>
              <tr>
                <td className="muted">speech → first partial</td>
                <td className="muted">
                  p50 {percentile(partials, 0.5) ?? '—'} ms (budget 300 ms)
                </td>
              </tr>
              <tr>
                <td className="muted">budget (ADR 0010)</td>
                <td className="muted">~2000 ms</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="mic-transcript">
        <h2 id="mic-transcript">What it heard</h2>
        <ol className="transcript">
          {utterances.map((utterance) => (
            <li key={utterance.id} className="segment">
              <div className="muted segment-meta">{utterance.speaker}</div>
              <p>{utterance.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
