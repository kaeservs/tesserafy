'use client';

import { useEffect } from 'react';

/**
 * Sections rise into view as they are reached: anything marked data-reveal
 * starts a little lower and settles once a fifth of it is on screen. It moves
 * but never fades, so its text is at full contrast throughout. Armed only once this has run, so without JavaScript, and for
 * reduced motion, everything is simply there.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('revealed');
          seen.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );
    // Whatever is already on screen shows at once; the rest waits to be reached.
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      if (box.top < window.innerHeight) target.classList.add('revealed');
      else seen.observe(target);
    }
    document.documentElement.classList.add('reveal-armed');
    return () => {
      seen.disconnect();
      document.documentElement.classList.remove('reveal-armed');
    };
  }, []);
  return null;
}
