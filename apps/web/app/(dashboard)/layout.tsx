import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import { createClient } from '@/lib/supabase/server';

/**
 * The shell every signed-in page sits in.
 *
 * The header is sticky because the nav is how you get from a meeting to the
 * insight it fed, and scrolling back up a long transcript to reach it is
 * friction on the one journey this product is about.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <>
      <header className="app-header">
        <nav className="nav" aria-label="Sections">
          <span className="brand">Tesserafy</span>
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/conversations">Meetings</NavLink>
          <NavLink href="/insights">Insights</NavLink>
          <NavLink href="/search">Search</NavLink>
          <NavLink href="/live/mic">Live</NavLink>
        </nav>
        <form action="/auth/sign-out" method="post" className="toolbar">
          <span className="muted">{user.email}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
