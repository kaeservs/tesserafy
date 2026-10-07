'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * The product on a sample call, to play with: a meeting with the overlay over
 * it. The call plays line by line (or steps, or pauses); each criterion lights
 * with the words that earned it and the score climbs; the four buttons answer
 * from what has been said so far, quoting it. Everything here is sample data
 * written for the page — no call, no model, nothing sent anywhere — and it
 * says so. It starts playing when it comes into view, except for anyone who
 * asked for reduced motion, who presses Play.
 */

type Who = 'seller' | 'customer';

interface Line {
  readonly who: Who;
  readonly at: string;
  readonly text: string;
  /** The criterion this line confirms, and the words that do it. */
  readonly meets?: { readonly criterion: Criterion; readonly quote: string };
}

type Criterion = 'Pain' | 'Cost' | 'Timeline' | 'Decision maker' | 'Next step';

const CRITERIA: readonly Criterion[] = ['Pain', 'Cost', 'Timeline', 'Decision maker', 'Next step'];

const CALL: readonly Line[] = [
  { who: 'seller', at: '00:12', text: 'Thanks for making time, Dana. How does month-end look for you today?' },
  {
    who: 'customer',
    at: '00:31',
    text: 'Honestly, painful. Month-end reporting takes us two full days every month.',
    meets: { criterion: 'Pain', quote: 'two full days every month' },
  },
  { who: 'seller', at: '00:52', text: 'What does that cost the team?' },
  {
    who: 'customer',
    at: '01:08',
    text: 'If we closed it in a day, that’s about eight thousand a month back.',
    meets: { criterion: 'Cost', quote: 'about eight thousand a month' },
  },
  { who: 'seller', at: '01:30', text: 'When would you want something in place?' },
  {
    who: 'customer',
    at: '01:44',
    text: 'We’d want something live before the Q3 board review.',
    meets: { criterion: 'Timeline', quote: 'before the Q3 board review' },
  },
  {
    who: 'customer',
    at: '02:05',
    text: 'I’d have to run it past our CFO, Priya, first.',
    meets: { criterion: 'Decision maker', quote: 'run it past our CFO, Priya' },
  },
  { who: 'seller', at: '02:20', text: 'Makes sense. Shall we set up time with Priya next week?' },
  {
    who: 'customer',
    at: '02:31',
    text: 'Yes — Thursday works for both of us.',
    meets: { criterion: 'Next step', quote: 'Thursday works for both of us' },
  },
];

type Button = 'assist' | 'say' | 'follow' | 'recap';

const BUTTONS: readonly { id: Button; label: string }[] = [
  { id: 'assist', label: 'Assist' },
  { id: 'say', label: 'What should I say?' },
  { id: 'follow', label: 'Follow-ups' },
  { id: 'recap', label: 'Recap' },
];

interface Answer {
  readonly title: string;
  /** A point, and the words it rests on when it rests on some (none until they are said). */
  readonly points: readonly { text: string; quote?: string | undefined }[];
}

/** What each button answers, from the lines heard so far: every point about the call quotes it. */
function answer(button: Button, heard: readonly Line[]): Answer {
  const met = new Map(heard.flatMap((line) => (line.meets ? [[line.meets.criterion, line.meets.quote] as const] : [])));
  const open = CRITERIA.filter((criterion) => !met.has(criterion));
  if (button === 'say') {
    if (!met.has('Pain')) return { title: 'What to say', points: [{ text: 'Ask about month-end: “What does it take your team today?”' }] };
    if (!met.has('Cost'))
      return { title: 'What to say', points: [{ text: 'Put a number on it: “What do those two days cost you?”', quote: met.get('Pain') }] };
    if (!met.has('Decision maker'))
      return {
        title: 'What to say',
        points: [{ text: 'Find who signs off: “Who else needs to see this before the Q3 review?”', ...(met.has('Timeline') ? { quote: met.get('Timeline') } : {}) }],
      };
    if (!met.has('Next step'))
      return { title: 'What to say', points: [{ text: 'Propose a next step: “Shall we set up time with Priya next week?”', quote: met.get('Decision maker') }] };
    return { title: 'What to say', points: [{ text: 'Confirm Thursday and send the recap today.', quote: met.get('Next step') }] };
  }
  if (button === 'assist') {
    const points = [...met.entries()].slice(-2).map(([criterion, quote]) => ({ text: `${criterion} is confirmed — build on it.`, quote }));
    return { title: 'Assist', points: points.length ? points : [{ text: 'Nothing confirmed yet: let Dana describe month-end in her words.' }] };
  }
  if (button === 'follow') {
    const questions: Record<Criterion, string> = {
      Pain: 'Where does month-end slow you down most?',
      Cost: 'What would getting those days back be worth?',
      Timeline: 'When does this need to be live?',
      'Decision maker': 'Who else has a say in this?',
      'Next step': 'What would a good next step look like?',
    };
    return {
      title: 'Follow-up questions',
      points: open.length ? open.slice(0, 3).map((criterion) => ({ text: questions[criterion] })) : [{ text: 'Every criterion is covered. Close with the next step.' }],
    };
  }
  return {
    title: 'Recap',
    points: met.size
      ? [...met.entries()].map(([criterion, quote]) => ({ text: criterion, quote }))
      : [{ text: 'Nothing said yet to recap.' }],
  };
}

export function CallDemo() {
  const [heard, setHeard] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pressed, setPressed] = useState<Button | null>(null);
  const [focus, setFocus] = useState<Criterion | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Start once it is in view, unless reduced motion was asked for.
  useEffect(() => {
    const element = box.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !started.current) {
        started.current = true;
        setPlaying(true);
      }
    }, { threshold: 0.15 });
    seen.observe(element);
    return () => seen.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (heard >= CALL.length) {
      setPlaying(false);
      return;
    }
    const next = setTimeout(() => setHeard((count) => Math.min(CALL.length, count + 1)), heard === 0 ? 600 : 2300);
    return () => clearTimeout(next);
  }, [playing, heard]);

  const lines = CALL.slice(0, heard);
  const met = new Map(lines.flatMap((line) => (line.meets ? [[line.meets.criterion, line] as const] : [])));
  const score = Math.round((met.size / CRITERIA.length) * 100);
  const last = lines.at(-1);
  const shown = pressed ? answer(pressed, lines) : null;
  const focused = focus ? met.get(focus) : undefined;
  const done = heard >= CALL.length;

  return (
    <figure className="demo" aria-labelledby="demo-caption" ref={box}>
      <div className="demo-meeting">
        <div className="demo-bar" aria-hidden="true">
          <span className="demo-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Northwind · Discovery call</span>
          <span className="demo-rec">● {last?.at ?? '00:00'}</span>
        </div>
        <div className="demo-people" aria-hidden="true">
          <div className={`demo-person${last?.who === 'customer' ? ' speaking' : ''}`}>
            <span className="demo-avatar">DW</span>
            <span className="demo-name">Dana Whitfield · Northwind</span>
          </div>
          <div className={`demo-person${last?.who === 'seller' ? ' speaking' : ''}`}>
            <span className="demo-avatar you">You</span>
            <span className="demo-name">You</span>
          </div>
        </div>
        <p className="demo-line" aria-live="polite">
          {last ? (
            <>
              <strong>{last.who === 'customer' ? 'Dana' : 'You'}</strong> {last.text}
            </>
          ) : (
            <span className="demo-hint">Press Play to start the sample call.</span>
          )}
        </p>
        <div className="demo-controls">
          <button type="button" onClick={() => (done ? (setHeard(0), setPressed(null), setFocus(null), setPlaying(true)) : setPlaying(!playing))}>
            {done ? 'Play again' : playing ? 'Pause' : heard ? 'Resume' : 'Play'}
          </button>
          <button type="button" onClick={() => setHeard((count) => Math.min(CALL.length, count + 1))} disabled={done}>
            Next line
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setHeard(0);
              setPressed(null);
              setFocus(null);
            }}
            disabled={heard === 0}
          >
            Restart
          </button>
        </div>
      </div>

      <div className="demo-overlay glass">
        <div className="demo-overlay-head">
          <span className="demo-brand">
            <Icon name="logo" size={16} /> {playing ? 'Listening' : done ? 'Call ended' : 'Paused'}
          </span>
          <span className="demo-score" aria-label={`Score ${score} out of 100`}>
            {score}
          </span>
        </div>
        <span className="demo-track" aria-hidden="true">
          <span className="demo-fill" style={{ width: `${Math.max(score, 3)}%` }} />
        </span>
        <ul className="demo-criteria">
          {CRITERIA.map((criterion) => {
            const line = met.get(criterion);
            return (
              <li key={criterion}>
                <button
                  type="button"
                  className={`demo-chip${line ? ' met' : ''}${focus === criterion ? ' focused' : ''}`}
                  aria-pressed={focus === criterion}
                  onClick={() => setFocus(focus === criterion ? null : criterion)}
                >
                  {criterion}
                </button>
                {line?.meets ? <span className="demo-quote">“{line.meets.quote}”</span> : null}
              </li>
            );
          })}
        </ul>
        {focused?.meets ? (
          <p className="demo-focus">
            {focus} · {focused.at} · Dana said “{focused.meets.quote}”
          </p>
        ) : null}
        <div className="demo-buttons">
          {BUTTONS.map((button) => (
            <button
              key={button.id}
              type="button"
              className={pressed === button.id ? 'pressed' : undefined}
              aria-pressed={pressed === button.id}
              onClick={() => setPressed(pressed === button.id ? null : button.id)}
            >
              {button.label}
            </button>
          ))}
        </div>
        <div className="demo-answer" aria-live="polite">
          {shown ? (
            <>
              <p className="demo-answer-title">{shown.title}</p>
              <ul>
                {shown.points.map((point) => (
                  <li key={point.text}>
                    {point.text}
                    {point.quote ? <span className="demo-answer-why"> — they said “{point.quote}”</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="demo-answer-hint">Press a button above: it answers from what has been said so far.</p>
          )}
        </div>
      </div>

      <figcaption id="demo-caption" className="demo-caption">
        A sample call, written for this page: play it, step through it, press the buttons. In a real call the scorecard is
        yours, and every point quotes what was actually said.
      </figcaption>
    </figure>
  );
}
