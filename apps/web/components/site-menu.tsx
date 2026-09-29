'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * The header's links on a phone: behind one Menu button instead of filling
 * the first screen. On anything wider the button is not shown and the links
 * sit in the header as always (CSS decides, so there is nothing to flash).
 *
 * The button says whether the menu is open, and how many notifications are
 * waiting, since the Notifications link is inside it. Going somewhere closes it.
 */
export function SiteMenu({ unread, children }: { unread: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Close' : 'Menu'}
        {!open && unread > 0 ? <span className="count"> · {unread > 99 ? '99+' : unread}</span> : null}
      </button>
      <div id="site-menu" className={`menu-panel${open ? ' open' : ''}`}>
        {children}
      </div>
    </>
  );
}
