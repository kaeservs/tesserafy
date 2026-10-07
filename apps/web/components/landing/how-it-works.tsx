'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * How it works, told by scrolling: the section pins while the three steps
 * slide in one after another, each with its large number. The progress is the
 * section's own scroll position, read on scroll and written to CSS variables,
 * so the movement is the browser's to draw. Until it has read once (and for
 * reduced motion, and on narrow screens, where the steps stack) every step is
 * simply shown.
 */

const STEPS = [
  {
    title: 'Before the call',
    body: 'Your next meeting comes from your calendar. Prepare it in a press: who it is with, what to open with, what to ask.',
  },
  {
    title: 'On the call',
    body: 'The overlay sits over Zoom, Teams or Meet. The scorecard fills as the customer speaks, and help is one press away.',
  },
  {
    title: 'After the call',
    body: 'The follow-up email, the action items and the insights are ready, each line quoting what was said.',
  },
] as const;

export function HowItWorks() {
  const section = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const element = section.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect();
        const travel = Math.max(1, box.height - window.innerHeight);
        setProgress(Math.min(1, Math.max(0, -box.top / travel)));
      });
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  return (
    <section ref={section} className="how" aria-labelledby="how-heading" data-moving={progress === null ? undefined : ''}>
      <div className="how-sticky">
        <p className="eyebrow">How it works</p>
        <h2 id="how-heading">Before, during and after every call</h2>
        <ol className="how-steps">
          {STEPS.map((step, index) => {
            // Each step takes its third of the scroll, arriving a little before it ends.
            const shown = progress === null ? 1 : Math.min(1, Math.max(0, progress * 3.3 - index * 1.05));
            return (
              <li key={step.title} className="how-step" style={{ '--shown': shown } as CSSProperties}>
                <span className="how-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
