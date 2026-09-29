import type { ReactNode } from 'react';

/**
 * A table that scrolls sideways inside itself when it is wider than the
 * screen, instead of pushing the whole page sideways on a phone.
 *
 * Focusable and named, because a region only a mouse or a finger can scroll
 * is one a keyboard user cannot read the end of: Tab reaches it, the arrow
 * keys scroll it, and a screen reader says what it holds.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={`${label}, scrolls sideways`} tabIndex={0}>
      {children}
    </div>
  );
}
