'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './icons';

/**
 * The shell's sidebar: the product in seven places, the plan, and you.
 *
 * Seven, not the sixteen links the header had grown to, grouped by what a
 * seller is doing — getting ready, on calls, asking, acting on insights — and
 * what an owner sets up. A group opens where you are, so its pages are one
 * click away without all of them being on screen at once. On a phone it is
 * a bar with a Menu button; going somewhere closes it.
 *
 * Where you are is stated with aria-current, not implied by colour.
 */

interface Item {
  readonly label: string;
  readonly href: string;
}

interface Group {
  readonly label: string;
  readonly icon: IconName;
  readonly href?: string;
  readonly items?: readonly Item[];
}

function groups(live: boolean): Group[] {
  return [
    { label: 'Home', icon: 'home', href: '/dashboard' },
    {
      label: 'Calls',
      icon: 'calls',
      items: [
        { label: 'Meetings', href: '/conversations' },
        { label: 'This week', href: '/week' },
        ...(live ? [{ label: 'Live', href: '/live/mic' }] : []),
        { label: 'Search', href: '/search' },
      ],
    },
    { label: 'Ask', icon: 'ask', href: '/ask' },
    {
      label: 'Prepare',
      icon: 'prepare',
      items: [
        { label: 'Call preps', href: '/prep' },
        { label: 'Customers', href: '/accounts' },
      ],
    },
    { label: 'Insights', icon: 'insights', href: '/insights' },
    {
      label: 'Team',
      icon: 'team',
      items: [
        { label: 'Reports', href: '/reports' },
        { label: 'Coaching', href: '/coaching' },
        { label: 'Examples', href: '/examples' },
      ],
    },
    {
      label: 'Setup',
      icon: 'setup',
      items: [
        { label: 'Get the overlay', href: '/overlay' },
        { label: 'Scorecards', href: '/scorecards' },
        { label: 'AI guidance', href: '/guidance' },
        { label: 'Knowledge', href: '/knowledge' },
        { label: 'Settings', href: '/settings' },
      ],
    },
  ];
}

const here = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Sidebar({
  email,
  name,
  role,
  plan,
  live,
}: {
  email: string;
  name: string;
  role: string;
  plan: string | null;
  live: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const all = groups(live);
  const [expanded, setExpanded] = useState<string | null>(
    () => all.find((group) => group.items?.some((item) => here(pathname, item.href)))?.label ?? null,
  );

  useEffect(() => {
    setOpen(false);
    const current = groups(live).find((group) => group.items?.some((item) => here(pathname, item.href)));
    if (current) setExpanded(current.label);
  }, [pathname, live]);

  const upgrade = plan === 'trial' || plan === 'basic';

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-top">
        <Link href="/dashboard" className="brand">
          <Icon name="logo" size={26} />
          <span>Tesserafy</span>
        </Link>
        <button type="button" className="sidebar-menu" aria-expanded={open} aria-controls="sidebar-nav" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <div className="sidebar-body" id="sidebar-nav">
        <nav aria-label="Sections">
          <ul className="side-nav">
            {all.map((group) => {
              if (group.href) {
                const current = here(pathname, group.href);
                return (
                  <li key={group.label}>
                    <Link href={group.href} className="side-link" {...(current ? { 'aria-current': 'page' as const } : {})}>
                      <Icon name={group.icon} />
                      <span>{group.label}</span>
                    </Link>
                  </li>
                );
              }
              const isOpen = expanded === group.label;
              const holdsCurrent = group.items?.some((item) => here(pathname, item.href)) ?? false;
              return (
                <li key={group.label}>
                  <button
                    type="button"
                    className={`side-link side-group${holdsCurrent ? ' holds-current' : ''}`}
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : group.label)}
                  >
                    <Icon name={group.icon} />
                    <span>{group.label}</span>
                    <span className="chevron">
                      <Icon name="chevron" size={16} />
                    </span>
                  </button>
                  {isOpen ? (
                    <ul className="side-sub">
                      {group.items?.map((item) => (
                        <li key={item.href}>
                          <Link href={item.href} className="side-sublink" {...(here(pathname, item.href) ? { 'aria-current': 'page' as const } : {})}>
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-foot">
          {upgrade ? (
            <div className="promo">
              <p>Upgrade to Pro for more calls, questions and live minutes.</p>
              <Link href="/settings#plan-heading" className="promo-button">
                See plans
              </Link>
            </div>
          ) : null}
          <details className="profile">
            <summary>
              <span className="avatar" aria-hidden="true">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-name">
                <strong>{name}</strong>
                <span className="muted">{role === 'owner' ? 'Owner' : 'Member'}</span>
              </span>
              <span className="chevron">
                <Icon name="chevron" size={16} />
              </span>
            </summary>
            <div className="profile-menu">
              <span className="muted profile-email">{email}</span>
              <Link href="/account">Your account and overlay</Link>
              <form action="/auth/sign-out" method="post">
                <button type="submit" className="link-button">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </aside>
  );
}
