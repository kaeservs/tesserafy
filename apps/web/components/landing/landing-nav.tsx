'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * The landing page's floating bar: the brand, a link to each section of the
 * page, and Start free. The landing page is one long page, so these are the
 * one place in the product where a link goes to a part of a page (CLAUDE.md,
 * Conventions); the page scrolls there smoothly, and the link for the section
 * on screen is marked as current. On a narrow screen the links fold into a
 * Menu button.
 */

export interface LandingSection {
  readonly id: string;
  readonly label: string;
}

export function LandingNav({ sections, start }: { sections: readonly LandingSection[]; start: { href: string; label: string } }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // The current section is the last one to have reached the middle of the window; above the first, none is.
  // Worked out again whenever anything crosses the middle — a jump to the foot of the page included.
  useEffect(() => {
    const targets = sections.flatMap((section) => {
      const element = document.getElementById(section.id);
      return element ? [element] : [];
    });
    const pick = () => {
      const middle = window.innerHeight / 2;
      let reached: string | null = null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= middle) reached = target.id;
      }
      setCurrent(reached);
    };
    const seen = new IntersectionObserver(pick, { rootMargin: '-50% 0px -50% 0px' });
    for (const target of targets) seen.observe(target);
    const hero = document.querySelector('.hero');
    if (hero) seen.observe(hero);
    return () => seen.disconnect();
  }, [sections]);

  // The menu closes on Escape, as a menu does.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <header className="landing-nav glass" data-open={open ? '' : undefined}>
      <Link href="/" className="brand">
        <Icon name="logo" size={24} />
        <span>Tesserafy</span>
      </Link>
      <button
        type="button"
        className="landing-menu"
        aria-expanded={open}
        aria-controls="landing-sections"
        onClick={() => setOpen(!open)}
      >
        Menu
      </button>
      <nav id="landing-sections" className="landing-sections" aria-label="On this page">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} aria-current={current === section.id ? 'true' : undefined} onClick={() => setOpen(false)}>
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Link href={start.href} className="button-primary">
        {start.label}
      </Link>
    </header>
  );
}
