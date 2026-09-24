import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import { supportBanner } from '@/lib/support-banner';
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

  // RLS lets a user read the access records about their own account and no
  // one else's, so this is the account asking whether it is open, not the
  // product deciding who is looking. See lib/support-banner.ts for why that is
  // the right question.
  const { data: access } = await supabase
    .from('support_access')
    .select('reason, expires_at')
    .eq('subject_user_id', user.id)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString());
  const banner = supportBanner(access ?? []);

  return (
    <>
      {banner ? (
        <div className="support-banner" role="status">
          <strong>{banner.headline}.</strong> {banner.detail}
        </div>
      ) : null}
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
