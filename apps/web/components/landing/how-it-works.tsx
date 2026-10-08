'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

/**
 * How it works, told by scrolling: the section pins while the three steps
 * slide in one after another, each with its large number. The progress is the
 * section's own scroll position, written straight to one CSS variable while
 * the section is near the screen — no re-render — and each step works out
 * its own share of it in CSS, so the movement is the browser's to draw. Until
 * it has read once (and for reduced motion, and on narrow screens, where the
 * steps stack) every step is simply shown.
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

  useEffect(() => {
    const element = section.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let near = false;
    const read = () => {
      if (!near || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = element.getBoundingClientRect();
        const travel = Math.max(1, box.height - window.innerHeight);
        element.style.setProperty('--progress', Math.min(1, Math.max(0, -box.top / travel)).toFixed(3));
        element.setAttribute('data-moving', '');
      });
    };
    // Read only while it is on screen or about to be: elsewhere the page scrolls without it.
    const seen = new IntersectionObserver(
      ([entry]) => {
        near = entry?.isIntersecting ?? false;
        read();
      },
      { rootMargin: '25% 0px' },
    );
    seen.observe(element);
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  return (
    <section ref={section} id="how-it-works" className="how" aria-labelledby="how-heading">
      <div className="how-sticky">
        <p className="eyebrow">How it works</p>
        <h2 id="how-heading">Before, during and after every call</h2>
        <ol className="how-steps">
          {STEPS.map((step, index) => (
            // Each step takes its third of the scroll, arriving a little before it ends.
            <li key={step.title} className="how-step" style={{ '--i': index } as CSSProperties}>
              <span className="how-number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
