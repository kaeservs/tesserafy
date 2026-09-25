'use client';

import type { CriterionPrompt } from '@tesserafy/ai';
import { apply, initialState, score, type CriteriaSet, type DetectorEvent } from '@tesserafy/scoring';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Shortfall } from '@/components/criterion-shortfall';
import { CONSENT_STATEMENTS } from '@/lib/consent';
import { LiveSession, type LiveSessionState } from '@/lib/live-session';

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

interface Suggestion {
  criterionKey: string;
  ask: string;
  because: string;
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
  // Not remembered between visits: each call is a different set of people.
  const [consented, setConsented] = useState(false);
  const [speaker, setSpeaker] = useState<'customer' | 'me'>('customer');
  const [interim, setInterim] = useState('');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [state, setState] = useState(() => initialState(scorecard));
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const stateRef = useRef(state);
  const sessionStart = useRef<number>(0);
  const speechStart = useRef<number | null>(null);
  const firstPartial = useRef<number | null>(null);
  const window_ = useRef<Utterance[]>([]);
  const speakerRef = useRef(speaker);
  // One per mounted page. A call is a session; reloading the page starts a
  // new one rather than appending to a conversation nobody is in any more.
  const session = useRef(new LiveSession());
  const [saved, setSaved] = useState<LiveSessionState>(session.current.current());

  useEffect(() => {
    speakerRef.current = speaker;
  }, [speaker]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setSupported(recogniser() !== null);
  }, []);

  useEffect(() => session.current.onChange(setSaved), []);

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
        const body = (await response.json()) as {
          events: DetectorEvent[];
          detector?: string;
          model?: string;
        };

        const nextState = body.events.reduce(apply, stateRef.current);
        stateRef.current = nextState;
        setState(nextState);

        // After the score, never before it: T2 is off the critical path.
        void fetch('/api/suggest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scorecard: score(nextState), window: recent }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload: { suggestion: Suggestion | null } | null) => {
            // Cleared when there is nothing to say. A stale suggestion has
            // someone asking about two minutes ago.
            setSuggestion(payload?.suggestion ?? null);
          })
          .catch(() => setSuggestion(null));

        setMeasurements((current) => [
          ...current,
          {
            firstPartialMs: partialMs,
            utteranceToScoreMs: Math.round(performance.now() - endedAt),
          },
        ]);

        // Also after the score, and for the same reason. Keeping the call is
        // worth doing and not worth a millisecond of the number this page is
        // judged on. The session resolves each local segment id to the one
        // the database assigned, which by now has usually already arrived.
        void session.current.saveEvents(
          body.events.map((event) => ({
            criterionKey: event.criterionKey,
            kind: event.kind,
            confidence: event.confidence,
            segmentId: event.span.segmentId,
            quote: event.span.quote,
            detector: body.detector ?? 'unknown',
            model: body.model ?? 'unknown',
          })),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'detection failed');
      }
    },
    [prompts],
  );

  const start = useCallback(() => {
    if (!consented) return;
    const engine = recogniser();
    if (!engine) return;

    // The conversation exists from the moment recording starts, so a call
    // that ends in a crashed tab is still a call that happened. A meeting
    // cannot be re-run.
    void session.current.start(
      `Live call — ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`,
      scorecard.engagementType,
      scorecard.version,
      consented,
    );

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

        // Alongside detection, not before it. Both start now; only detection
        // is awaited, so saving the utterance never sits between somebody
        // finishing a sentence and the score moving.
        session.current.appendSegment(utterance.id, {
          speaker: utterance.speaker,
          startMs: utterance.startMs,
          endMs: utterance.endMs,
          text: utterance.text,
        });
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
  }, [consented, detect, scorecard.engagementType, scorecard.version]);

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
      {/*
        Asked before the first word, not after: the recording starts the
        moment the button is pressed. The words are the ones stored with the
        call.
      */}
      <div className="field consent">
        <label>
          <input
            type="checkbox"
            checked={consented}
            disabled={listening}
            onChange={(event) => setConsented(event.target.checked)}
          />{' '}
          {CONSENT_STATEMENTS.live}
        </label>
      </div>
      <div className="toolbar">
        <button type="button" onClick={listening ? stop : start} disabled={!listening && !consented}>
          {listening ? 'Stop listening' : 'Start listening'}
        </button>
        <button type="button" onClick={() => setSpeaker((s) => (s === 'customer' ? 'me' : 'customer'))}>
          Speaking: {speaker === 'customer' ? 'the customer' : 'me'}
        </button>
        <span className="muted">{utterances.length} utterances</span>
      </div>

      {/*
        Whether the call is being kept, said plainly while it is happening.
        A page that silently failed to save would be discovered afterwards,
        by someone looking for a meeting that is not there.
      */}
      <p className="muted" aria-live="polite">
        {saved.conversationId ? (
          <>
            Saving to{' '}
            <Link href={`/conversations/${saved.conversationId}`}>this conversation</Link> ·{' '}
            {saved.saved} utterance{saved.saved === 1 ? '' : 's'}, {saved.recorded} evidence
            {saved.lost > 0 && ` · ${saved.lost} write${saved.lost === 1 ? '' : 's'} failed`}
          </>
        ) : listening ? (
          'Not being saved — this session will be lost when the page closes.'
        ) : (
          'Recording starts a conversation you can open afterwards.'
        )}
      </p>
      <p className="muted">
        Who is speaking is a toggle because diarisation is not solved here. It matters: the detector
        is told to report the customer’s words, not the seller’s.
      </p>

      {error && <p role="alert">{error}</p>}

      {suggestion && (
        <aside className="suggestion" aria-live="polite">
          <p className="suggestion-ask">{suggestion.ask}</p>
          <p className="muted">
            because they said “{suggestion.because}” · {suggestion.criterionKey}
          </p>
        </aside>
      )}

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
                <span>
                  {criterion.label}
                  <Shortfall shortfall={criterion.shortfall} />
                </span>
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
                {/* The same pair the replay page shows. ADR 0010 is proposed,
                    not accepted, and a page that quotes it as the budget makes
                    an undecided number look settled. */}
                <td className="muted">budget</td>
                <td className="muted">1300 ms (ADR 0002) · ~2000 ms proposed (ADR 0010)</td>
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
