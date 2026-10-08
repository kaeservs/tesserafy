'use client';

import { useEffect } from 'react';

/**
 * What the hero needs from a script, which is little. It pauses the birds
 * while the hero is off screen. And where the browser has no scroll timeline
 * (Firefox, as of 155), it does that timeline's work: how far the hero has
 * scrolled away, 0 to 1, written to --away on it for the CSS to move the
 * painting, the birds and the words by. Where there is a scroll timeline the
 * browser draws all of that itself, off the page's thread, and this only
 * pauses birds. Nothing at all for reduced motion.
 */
export function HeroMotion() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>('.hero');
    if (!hero || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fallback = !CSS.supports('animation-timeline: view()');

    // The timeline's exit range: from the hero's foot at the bottom of the window to its foot at the top.
    let visible = true;
    let frame = 0;
    const read = () => {
      if (!fallback || !visible || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const away = (window.innerHeight - hero.getBoundingClientRect().bottom) / window.innerHeight;
        hero.style.setProperty('--away', Math.min(1, Math.max(0, away)).toFixed(3));
      });
    };

    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      hero.toggleAttribute('data-offscreen', !visible);
      read();
    });
    seen.observe(hero);
    if (fallback) {
      hero.setAttribute('data-away', '');
      window.addEventListener('scroll', read, { passive: true });
      window.addEventListener('resize', read);
    }
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      hero.removeAttribute('data-away');
      hero.removeAttribute('data-offscreen');
    };
  }, []);
  return null;
}
