'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SectionTab {
  readonly href: string;
  readonly label: string;
}

/** Settings, each a page of its own: a link can be shared, bookmarked and gone back to. */
export const SETTINGS_TABS: readonly SectionTab[] = [
  { href: '/settings/membership', label: 'Membership' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/calls', label: 'Calls' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/data', label: 'Data' },
];

/** The signed-in person's own account, likewise. */
export const ACCOUNT_TABS: readonly SectionTab[] = [
  { href: '/account', label: 'Profile' },
  { href: '/account/overlay', label: 'Overlay' },
  { href: '/account/calendar', label: 'Calendar' },
  { href: '/account/delete', label: 'Delete account' },
];

/**
 * The pages of one area, along its top. Every section has its own path rather
 * than an anchor on one long page, so the address says where you are.
 */
export function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="section-tabs">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link href={tab.href} aria-current={pathname === tab.href ? 'page' : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
