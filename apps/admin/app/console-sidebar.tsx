'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The console's sidebar: every page, grouped by what an operator is doing,
 * the current one in the accent. Counts that wait on an operator (access
 * requests, new feedback) sit beside their page, because there is no email
 * to say so.
 */

const GROUPS: readonly { label: string; items: readonly { label: string; href: string; count?: 'requests' | 'feedback' | 'early' }[] }[] = [
  { label: '', items: [{ label: 'Overview', href: '/' }] },
  {
    label: 'Customers',
    items: [
      { label: 'Companies', href: '/companies' },
      { label: 'People', href: '/people' },
      { label: 'Add people', href: '/onboard', count: 'requests' },
      { label: 'Agreements', href: '/agreements' },
      { label: 'Early access', href: '/early-access', count: 'early' },
    ],
  },
  {
    label: 'Usage',
    items: [
      { label: 'Adoption', href: '/adoption' },
      { label: 'Spend', href: '/spend' },
      { label: 'Activity', href: '/activity' },
    ],
  },
  {
    label: 'Health',
    items: [
      { label: 'Health', href: '/health' },
      { label: 'Failures', href: '/failures' },
      { label: 'Alerts', href: '/alerts' },
    ],
  },
  {
    label: 'Support',
    items: [
      { label: 'Access history', href: '/history' },
      { label: 'Feedback', href: '/feedback', count: 'feedback' },
      { label: 'Security', href: '/security' },
    ],
  },
];

export function ConsoleSidebar({ counts, footer }: { counts: { requests: number; feedback: number; early: number }; footer: React.ReactNode }) {
  const pathname = usePathname();
  const current = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9zM12 8.5l3.5 2v3.5L12 16l-3.5-2v-3.5z" />
        </svg>
        Tesserafy <span className="operator">Operator</span>
      </Link>
      <nav aria-label="Console">
        {GROUPS.map((group) => (
          <div key={group.label || 'top'}>
            {group.label ? <p className="side-group-label">{group.label}</p> : null}
            {group.items.map((item) => {
              const waiting = item.count ? counts[item.count] : 0;
              return (
                <Link key={item.href} href={item.href} className="side-link" {...(current(item.href) ? { 'aria-current': 'page' as const } : {})}>
                  {item.label}
                  {waiting > 0 ? <span className="tag open">{waiting}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">{footer}</div>
    </aside>
  );
}
