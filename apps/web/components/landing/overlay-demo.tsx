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
  sayNextAfter,
  scorecardAfter,
  talkShares,
  type Answer,
  type AssistMode,
  type Side,
} from './sample-call';

/**
 * The overlay on a sample call, to play with: a meeting with the desktop
 * overlay floating over it, drawn as the overlay draws itself
 * (apps/desktop/src/renderer/index.html) — the bar with the score, what to
 * say next first and largest, the four buttons and the ask box, and the
 * scorecard folded under one line — in the same choice of looks as Your
 * account → Overlay. It can be dragged anywhere over the meeting (by its grip
 * on a touch screen, or the arrow keys on the grip), and restyled from the
 * panel beside it.
 *
 * Front end only. The call is written for the page (./sample-call), its
 * scorecard is packages/scoring's, and nothing is recorded, sent or kept. It
 * starts when it comes into view, except for anyone who asked for reduced
 * motion, who presses Start. When it ends, nothing is summed up on the card:
 * in the product, the call's scorecard and follow-up are on its page in the
 * dashboard.
 */

type Theme = (typeof OVERLAY_THEMES)[number]['value'];
type Accent = (typeof OVERLAY_ACCENTS)[number]['value'];
type Size = (typeof OVERLAY_SIZES)[number]['value'];

/** The overlay's zoom for each size (apps/desktop/src/main/appearance.ts). */
const SCALE: Record<Size, number> = { small: 0.85, normal: 1, large: 1.2 };

/** The four buttons, as the overlay labels them, with the bubble each puts over its answer. */
const BUTTONS: readonly { mode: AssistMode; label: string; icon: string }[] = [
  {
    mode: 'assist',
    label: 'Assist',
    icon: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
  },
  { mode: 'say', label: 'What should I say?', icon: 'M4 20 15 9M14 4v2M19 9h2M17.5 5.5 19 4M9 4l.6 1.6L11 6l-1.4.4L9 8l-.6-1.6L7 6l1.4-.4z' },
  { mode: 'followups', label: 'Follow-up questions', icon: 'M4 5h16v11H9.5L4 20z' },
  { mode: 'recap', label: 'Recap', icon: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4' },
];

const SIDE_NAME: Record<Side, string> = { me: 'You', them: 'Them' };
const LINE_MS = 2600;
/** Kept clear of the meeting's edges, in px. */
const EDGE = 12;

function choose<T extends string>(options: readonly { value: T }[], wanted: string, fallback: T): T {
  return options.find((option) => option.value === wanted)?.value ?? fallback;
}

interface Shown {
  /** What was asked: a button's label or the question typed, shown as a bubble. */
  readonly asked: string;
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
  const [ended, setEnded] = useState(false);
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
  const done = heard >= total;
  const card = useMemo(() => scorecardAfter(heard), [heard]);
  const talk = useMemo(() => talkShares(heard), [heard]);
  const next = useMemo(() => sayNextAfter(heard), [heard]);
  const captions = SAMPLE_CALL.slice(Math.max(0, heard - 3), heard);
  const last = SAMPLE_CALL[heard - 1];
  const speaking = listening ? last?.side : undefined;
  const confirmed = card.criteria.filter((criterion) => criterion.status === 'confirmed').length;
  const rounded = Math.round(card.score);
  const inCall = listening || heard > 0;

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
    const timer = setTimeout(() => setHeard((count) => Math.min(total, count + 1)), heard === 0 ? 700 : LINE_MS);
    return () => clearTimeout(timer);
  }, [listening, heard, total]);

  // The last line ends the call: listening stops, and the card says where the call's scorecard and follow-up are.
  useEffect(() => {
    if (heard < total) return;
    setListening(false);
    setEnded(true);
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
    if (!onGrip && (event.pointerType === 'touch' || target?.closest('button, input, label, a, select, textarea, summary'))) return;
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
    if (done) {
      setHeard(0);
      setShown(null);
    }
    setEnded(false);
    setListening(true);
  };

  const nextLine = () => {
    started.current = true;
    setHeard((count) => Math.min(total, count + 1));
  };

  const startOver = () => {
    started.current = true;
    setListening(false);
    setEnded(false);
    setHeard(0);
    setShown(null);
    setQuestion('');
  };

  const hide = (value: boolean) => {
    toggled.current = true;
    setHidden(value);
  };

  const press = (button: (typeof BUTTONS)[number]) => setShown({ asked: button.label, answer: assist(button.mode, heard) });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const asked = question.trim();
    const answer = ask(asked, heard);
    if (!answer) return;
    setShown({ asked, answer });
    setQuestion('');
  };

  const status = listening ? 'listening to both sides' : ended ? 'call ended' : heard > 0 ? 'stopped' : 'idle';

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
                <span className="od-bar-note">Dana Whitfield, Northwind</span>
                {inCall ? (
                  <span className="od-score-box">
                    <span className="od-engagement">
                      {card.engagementType} v{card.criteriaVersion}
                    </span>
                    <span
                      className="od-meter"
                      role="progressbar"
                      aria-label="Score"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={rounded}
                    >
                      <span className="od-meter-fill" style={{ width: `${rounded}%` }} />
                    </span>
                    <span className="od-score">{rounded}</span>
                  </span>
                ) : null}
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

              {ended ? (
                <p className="od-banner" role="status">
                  Call saved. In the app its scorecard and follow-up wait in your dashboard — nothing to read here.
                </p>
              ) : null}

              {listening ? (
                <section className={`od-say${next.waiting ? ' waiting' : ''}`} aria-label="What to say next">
                  <p className="od-say-label">{next.label}</p>
                  <p className="od-say-text">{next.text}</p>
                  {next.why ? <p className="od-say-why">{next.why}</p> : null}
                </section>
              ) : null}

              <section className="od-assist" aria-label="Assist">
                {shown ? (
                  <div className="od-answer" aria-live="polite">
                    <div className="od-answer-head">
                      <span className="od-asked">{shown.asked}</span>
                      <button type="button" className="od-close" aria-label="Close the answer" onClick={() => setShown(null)}>
                        ×
                      </button>
                    </div>
                    <ul>
                      {shown.answer.points.map((point) => (
                        <li key={point.text}>
                          {point.text}
                          {point.quote ? <span className="od-quote">“{point.quote}”</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="od-actions">
                  {BUTTONS.map((button, index) => (
                    <span key={button.mode} className="od-action">
                      {index > 0 ? (
                        <span className="od-dot" aria-hidden="true">
                          ·
                        </span>
                      ) : null}
                      <button type="button" onClick={() => press(button)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d={button.icon} />
                        </svg>
                        {button.label}
                      </button>
                    </span>
                  ))}
                </div>
                <form className="od-ask" onSubmit={submit}>
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    maxLength={200}
                    autoComplete="off"
                    placeholder="Ask about the call — try “who decides?”"
                    aria-label="Ask about the call"
                  />
                  <button type="submit" className="od-send" aria-label="Ask">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M8 5.5v13L18.5 12z" />
                    </svg>
                  </button>
                </form>
              </section>

              <div className="od-foot">
                <details className="od-details">
                  <summary>
                    Scorecard · {confirmed} of {card.criteria.length} confirmed
                  </summary>
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
                        const answered =
                          card.criteria.find((criterion) => criterion.key === item.criterion)?.status === 'confirmed';
                        return (
                          <li key={item.ask} className={answered ? 'done' : undefined}>
                            {item.ask}
                            {answered ? <span className="visually-hidden"> (answered)</span> : null}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
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
                </details>
                <span className="od-status">{status}</span>
              </div>
            </div>
          )}
        </div>

        <div className="od-controls">
          <span className="od-progress">
            Sample call · line {heard} of {total}
          </span>
          <button type="button" onClick={nextLine} disabled={done}>
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
          The same choices as in the app. Glass is clear smoked glass, so you still see the call through it; Background is how
          dark it is, never below {OVERLAY_MIN_OPACITY}%. Light is frosted instead.
        </p>
      </form>
    </div>
  );
}
