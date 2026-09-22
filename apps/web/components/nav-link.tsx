'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A nav item that knows whether it is the page you are on.
 *
 * `aria-current="page"` rather than a class alone: the styling hangs off the
 * attribute, so the thing a screen reader announces and the thing a sighted
 * reader sees cannot drift apart — there is only one source for both.
 *
 * A section matches its subpages, so opening one meeting keeps Meetings lit.
 * The exception is the root of each section being an exact match, which is why
 * `/` would otherwise match everything.
 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className="nav-link" {...(current ? { 'aria-current': 'page' as const } : {})}>
      {children}
    </Link>
  );
}
