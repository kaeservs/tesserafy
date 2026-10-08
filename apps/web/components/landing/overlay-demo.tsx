'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { DEFAULT_LOOK, OVERLAY_ACCENTS, OVERLAY_MIN_OPACITY, OVERLAY_SIZES, OVERLAY_THEMES } from '@/lib/overlay-look';
import {
  SAMPLE_CALL,
  TO_ASK,
  ask,
  assist,
  scorecardAfter,
  suggestionAfter,
  talkShares,
  type Answer,
  type AssistMode,
  type Side,
} from './sample-call';

/**
 * The overlay on a sample call, to play with: a meeting with the desktop
 * overlay floating over it, drawn as the overlay draws itself
 * (apps/desktop/src/renderer/index.html) — the same bar, scorecard chips,
 * captions, suggestion, four buttons and ask box, and the same choice of
 * looks as Your account → Overlay. It can be dragged anywhere over the
 * meeting (by its grip on a touch screen, or the arrow keys on the grip), and
 * restyled from the panel beside it.
 *
 * Front end only. The call is written for the page (./sample-call), its
 * scorecard is packages/scoring's, and nothing is recorded, sent or kept. It
 * starts when it comes into view, except for anyone who asked for reduced
 * motion, who presses Start.
 */

type Theme = (typeof OVERLAY_THEMES)[number]['value'];
type Accent = (typeof OVERLAY_ACCENTS)[number]['value'];
type Size = (typeof OVERLAY_SIZES)[number]['value'];

/** The overlay's zoom for each size (apps/desktop/src/main/appearance.ts). */
const SCALE: Record<Size, number> = { small: 0.85, normal: 1, large: 1.2 };

const BUTTONS: readonly { mode: AssistMode; label: string }[] = [
  { mode: 'assist', label: 'Assist' },
  { mode: 'say', label: 'What should I say?' },
  { mode: 'followups', label: 'Follow-up questions' },
  { mode: 'recap', label: 'Recap' },
];

const SIDE_NAME: Record<Side, string> = { me: 'You', them: 'Them' };
const LINE_MS = 2600;
/** Kept clear of the meeting's edges, in px. */
const EDGE = 12;

function choose<T extends string>(options: readonly { value: T }[], wanted: string, fallback: T): T {
  return options.find((option) => option.value === wanted)?.value ?? fallback;
}

interface Shown {
  /** Which button asked, so pressing another replaces it. */
  readonly by: AssistMode | 'ask' | 'call-recap';
  readonly answer: Answer;
}

export function OverlayDemo() {
  const [theme, setTheme] = useState<Theme>(() => choose(OVERLAY_THEMES, DEFAULT_LOOK.theme, 'glass'));
  const [accent, setAccent] = useState<Accent>(() => choose(OVERLAY_ACCENTS, DEFAULT_LOOK.accent, 'indigo'));
  const [size, setSize] = useState<Size>(() => choose(OVERLAY_SIZES, DEFAULT_LOOK.size, 'normal'));
  const [opacity, setOpacity] = useState(DEFAULT_LOOK.opacity);

  const [heard, setHeard] = useState(0);
  const [listening, setListening] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [question, setQuestion] = useState('');
  const [hidden, setHidden] = useState(false);
  /** Where it was dragged to, in the meeting's own pixels; null while it sits in its corner. */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const hideButton = useRef<HTMLButtonElement>(null);
  const dragging = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const started = useRef(false);
  const toggled = useRef(false);

  const total = SAMPLE_CALL.length;
  const ended = heard >= total;
  const card = useMemo(() => scorecardAfter(heard), [heard]);
  const talk = useMemo(() => talkShares(heard), [heard]);
  const suggestion = useMemo(() => suggestionAfter(heard), [heard]);
  const captions = SAMPLE_CALL.slice(Math.max(0, heard - 3), heard);
  const last = SAMPLE_CALL[heard - 1];
  const speaking = listening ? last?.side : undefined;
  const confirmed = card.criteria.filter((criterion) => criterion.status === 'confirmed').length;
  const rounded = Math.round(card.score);

  // Start once it is in view, unless reduced motion was asked for.
  useEffect(() => {
    const element = stage.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started.current) {
          started.current = true;
          setListening(true);
        }
      },
      { threshold: 0.4 },
    );
    seen.observe(element);
    return () => seen.disconnect();
  }, []);

  // One line at a time while listening.
  useEffect(() => {
    if (!listening || heard >= total) return;
    const next = setTimeout(() => setHeard((count) => Math.min(total, count + 1)), heard === 0 ? 700 : LINE_MS);
    return () => clearTimeout(next);
  }, [listening, heard, total]);

  // When the call ends, the overlay asks for its recap by itself, as the real one does.
  useEffect(() => {
    if (heard < total) return;
    setListening(false);
    setShown({ by: 'call-recap', answer: { ...assist('recap', heard), title: 'Call recap' } });
  }, [heard, total]);

  const clamp = useCallback((x: number, y: number) => {
    const area = stage.current;
    const box = overlay.current;
    if (!area || !box) return { x, y };
    const maxX = Math.max(EDGE, area.clientWidth - box.offsetWidth - EDGE);
    const maxY = Math.max(EDGE, area.clientHeight - box.offsetHeight - EDGE);
    return { x: Math.round(Math.min(maxX, Math.max(EDGE, x))), y: Math.round(Math.min(maxY, Math.max(EDGE, y))) };
  }, []);

  // Kept inside the meeting when the window narrows or the overlay grows.
  useEffect(() => {
    const area = stage.current;
    const box = overlay.current;
    if (!area || !box) return;
    const fit = () =>
      setPos((at) => {
        if (!at) return at;
        const next = clamp(at.x, at.y);
        return next.x === at.x && next.y === at.y ? at : next;
      });
    const watch = new ResizeObserver(fit);
    watch.observe(area);
    watch.observe(box);
    return () => watch.disconnect();
  }, [clamp, hidden]);

  // Focus follows Hide and Show, so a keyboard is never left on nothing.
  useEffect(() => {
    if (!toggled.current) return;
    (hidden ? showButton : hideButton).current?.focus();
  }, [hidden]);

  /** Where the overlay is now, in the meeting's pixels. */
  const where = () => {
    const area = stage.current;
    const box = overlay.current;
    if (!area || !box) return { x: EDGE, y: EDGE };
    const a = area.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return { x: b.left - a.left - area.clientLeft, y: b.top - a.top - area.clientTop };
  };

  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const onGrip = target?.closest('.od-grip') != null;
    // A finger scrolls the page unless it takes the grip; a mouse can take the card anywhere but its controls.
    if (!onGrip && (event.pointerType === 'touch' || target?.closest('button, input, label, a, select, textarea'))) return;
    const at = where();
    dragging.current = { id: event.pointerId, dx: event.clientX - at.x, dy: event.clientY - at.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = '';
    setPos(clamp(at.x, at.y));
    event.preventDefault();
  };

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const held = dragging.current;
    if (!held || held.id !== event.pointerId) return;
    setPos(clamp(event.clientX - held.dx, event.clientY - held.dy));
  };

  const drop = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
    delete event.currentTarget.dataset.dragging;
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 48 : 12;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      default:
        return;
    }
    event.preventDefault();
    const at = pos ?? where();
    setPos(clamp(at.x + dx, at.y + dy));
  };

  const listen = () => {
    started.current = true;
    if (listening) {
      setListening(false);
      return;
    }
    if (ended) {
      setHeard(0);
      setShown(null);
    }
    setListening(true);
  };

  const nextLine = () => {
    started.current = true;
    setHeard((count) => Math.min(total, count + 1));
  };

  const startOver = () => {
    started.current = true;
    setListening(false);
    setHeard(0);
    setShown(null);
    setQuestion('');
  };

  const hide = (value: boolean) => {
    toggled.current = true;
    setHidden(value);
  };

  const press = (mode: AssistMode) => setShown({ by: mode, answer: assist(mode, heard) });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = ask(question, heard);
    if (answer) setShown({ by: 'ask', answer });
  };

  const status = listening ? 'listening' : ended ? 'call ended' : heard > 0 ? 'stopped' : 'idle';

  return (
    <div className="od">
      <div className="od-main">
        <div className="od-stage" ref={stage}>
          <div className="od-meeting" aria-hidden="true">
            <div className="od-meeting-bar">
              <span className="od-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="od-meeting-title">Northwind · Discovery call</span>
              <span className="od-rec">● {last?.at ?? '00:00'}</span>
            </div>
            <div className="od-people">
              <div className={`od-person them${speaking === 'them' ? ' speaking' : ''}`}>
                <span className="od-avatar">DW</span>
                <span className="od-name">Dana Whitfield · Northwind</span>
              </div>
              <div className={`od-person me${speaking === 'me' ? ' speaking' : ''}`}>
                <span className="od-avatar">You</span>
                <span className="od-name">You</span>
              </div>
            </div>
            <div className="od-meeting-controls">
              <i className="mic" />
              <i className="cam" />
              <i className="share" />
              <i className="leave" />
            </div>
          </div>

          {hidden ? (
            <button type="button" className="od-show" ref={showButton} onClick={() => hide(false)}>
              Show Tesserafy
            </button>
          ) : (
            <div
              ref={overlay}
              className={`od-card${pos ? ' od-card--moved' : ''}`}
              data-theme={theme}
              data-accent={accent}
              role="group"
              aria-label="Tesserafy overlay, on a sample call"
              style={
                {
                  '--k': SCALE[size],
                  '--o-alpha': opacity / 100,
                  ...(pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : {}),
                } as CSSProperties
              }
              onPointerDown={grab}
              onPointerMove={drag}
              onPointerUp={drop}
              onPointerCancel={drop}
            >
              <div className="od-bar">
                <button type="button" className="od-primary" onClick={listen}>
                  {listening ? 'Stop' : 'Start'}
                </button>
                <button type="button" ref={hideButton} onClick={() => hide(true)}>
                  Hide
                </button>
                <span className="od-muted od-bar-note">Northwind discovery{heard === 0 ? ' · now' : ''}</span>
                <button
                  type="button"
                  className="od-grip"
                  aria-label="Move the overlay"
                  title="Drag to move it, or use the arrow keys"
                  onKeyDown={nudge}
                >
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                    <circle cx="4" cy="3" r="1.1" />
                    <circle cx="8" cy="3" r="1.1" />
                    <circle cx="4" cy="6" r="1.1" />
                    <circle cx="8" cy="6" r="1.1" />
                    <circle cx="4" cy="9" r="1.1" />
                    <circle cx="8" cy="9" r="1.1" />
                  </svg>
                </button>
              </div>

              <div className="od-head">
                <p className="od-engagement">
                  {card.engagementType} v{card.criteriaVersion}
                </p>
                <div
                  className="od-meter"
                  role="progressbar"
                  aria-label="Score"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={rounded}
                >
                  <div className="od-meter-fill" style={{ width: `${rounded}%` }} />
                </div>
                <span className="od-score">{rounded}</span>
              </div>

              <ul className="od-criteria" aria-label="Scorecard">
                {card.criteria.map((criterion) => {
                  const short = criterion.shortfall;
                  const counting = short && short.segmentsNeeded > 1 && short.segments > 0;
                  return (
                    <li
                      key={criterion.key}
                      className={`od-chip ${criterion.status}`}
                      title={`${criterion.label}: ${criterion.status}${counting ? ` (${short.segments} of ${short.segmentsNeeded} mentions)` : ''}`}
                    >
                      <span className={`od-state ${criterion.status}`} aria-hidden="true" />
                      <span>{criterion.label}</span>
                      <span className="visually-hidden">: {criterion.status}</span>
                      {counting ? (
                        <span className="od-hint">
                          {short.segments}/{short.segmentsNeeded}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {talk.words >= 30 ? (
                <p className="od-talk">
                  You {Math.round(talk.me * 100)}% · Them {Math.round(talk.them * 100)}% of the talking
                </p>
              ) : null}

              <section className="od-to-ask" aria-label="To ask">
                <p className="od-sub">To ask</p>
                <ol>
                  {TO_ASK.map((item) => {
                    const done = card.criteria.find((criterion) => criterion.key === item.criterion)?.status === 'confirmed';
                    return (
                      <li key={item.ask} className={done ? 'done' : undefined}>
                        {item.ask}
                        {done ? <span className="visually-hidden"> (answered)</span> : null}
                      </li>
                    );
                  })}
                </ol>
              </section>

              {suggestion ? (
                <aside className="od-suggestion" aria-label="Suggestion">
                  <p className="od-suggestion-ask">{suggestion.ask}</p>
                  <p className="od-suggestion-why">because they said “{suggestion.because}”</p>
                </aside>
              ) : null}

              {captions.length ? (
                <section className="od-captions" aria-label="Live transcript">
                  {captions.map((line) => (
                    <p key={line.at}>
                      <span className="od-side">{SIDE_NAME[line.side]}</span>
                      {line.text}
                    </p>
                  ))}
                </section>
              ) : null}

              <section className="od-assist" aria-label="Assist">
                <div className="od-answer" aria-live="polite">
                  {shown ? (
                    <>
                      <p className="od-answer-title">{shown.answer.title}</p>
                      <ul>
                        {shown.answer.points.map((point) => (
                          <li key={point.text}>
                            {point.text}
                            {point.quote ? <span className="od-quote">“{point.quote}”</span> : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="od-answer-hint">Press a button: it answers from what has been said so far.</p>
                  )}
                </div>
                <div className="od-actions">
                  {BUTTONS.map((button) => (
                    <button key={button.mode} type="button" onClick={() => press(button.mode)}>
                      {button.label}
                    </button>
                  ))}
                </div>
                <form className="od-ask" onSubmit={submit}>
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    maxLength={200}
                    autoComplete="off"
                    placeholder="Ask about the call"
                    aria-label="Ask about the call"
                  />
                  <button type="submit">Ask</button>
                </form>
              </section>

              <div className="od-foot">
                <span className="od-muted">
                  {status}
                  {heard > 0 ? ` · ${confirmed}/${card.criteria.length} confirmed` : ''}
                </span>
                <span className="od-muted od-keeping">a sample: nothing is kept</span>
              </div>
            </div>
          )}
        </div>

        <div className="od-controls">
          <span className="od-progress">
            Sample call · line {heard} of {total}
          </span>
          <button type="button" onClick={nextLine} disabled={ended}>
            Next line
          </button>
          <button type="button" onClick={startOver} disabled={heard === 0}>
            Start over
          </button>
        </div>
      </div>

      <form className="od-look pane" aria-labelledby="od-look-heading" onSubmit={(event) => event.preventDefault()}>
        <h3 id="od-look-heading">How it looks</h3>
        <fieldset className="od-field">
          <legend>Theme</legend>
          <div className="od-segments">
            {OVERLAY_THEMES.map((option) => (
              <label key={option.value} className="od-segment">
                <input
                  type="radio"
                  name="od-theme"
                  value={option.value}
                  checked={theme === option.value}
                  onChange={() => setTheme(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="od-field">
          <legend>Accent</legend>
          <div className="od-swatches">
            {OVERLAY_ACCENTS.map((option) => (
              <label key={option.value} className="od-swatch" data-accent-choice={option.value} title={option.label}>
                <input
                  type="radio"
                  name="od-accent"
                  value={option.value}
                  checked={accent === option.value}
                  onChange={() => setAccent(option.value)}
                />
                <span className="visually-hidden">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="od-field">
          <label htmlFor="od-opacity" className="od-legend">
            Background
          </label>
          <div className="od-range">
            <input
              id="od-opacity"
              type="range"
              min={OVERLAY_MIN_OPACITY}
              max={100}
              step={1}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              aria-describedby="od-opacity-note"
            />
            <output htmlFor="od-opacity">{opacity}%</output>
          </div>
        </div>
        <fieldset className="od-field">
          <legend>Size</legend>
          <div className="od-segments">
            {OVERLAY_SIZES.map((option) => (
              <label key={option.value} className="od-segment">
                <input
                  type="radio"
                  name="od-size"
                  value={option.value}
                  checked={size === option.value}
                  onChange={() => setSize(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="od-reset"
          onClick={() => {
            setPos(null);
            if (hidden) hide(false);
          }}
          disabled={!pos && !hidden}
        >
          Put it back in its corner
        </button>
        <p id="od-opacity-note" className="od-note">
          The same choices as in the app. Background never goes below {OVERLAY_MIN_OPACITY}%, so the words stay readable; on
          Glass it is how much white sits over the frosted meeting.
        </p>
      </form>
    </div>
  );
}
