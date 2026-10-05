import { FeedbackLink } from '@/components/feedback-link';
import { liveAvailable, myCompany } from '@/lib/company';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Sidebar } from '@/components/sidebar';
import { supportBanner } from '@/lib/support-banner';
import { supportSessionEnded } from '@/lib/support-session';
import { createClient } from '@/lib/supabase/server';

/**
 * The shell every signed-in page sits in: the sidebar (the product in seven
 * places, the plan, you), and a top bar with search and notifications. The
 * sidebar stays put while the page scrolls, because it is how you get from a
 * meeting to the insight it fed.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // A support session whose window has closed is signed out here, on the
  // first page it asks for (lib/support-session).
  if (await supportSessionEnded(supabase, (await supabase.auth.getSession()).data.session?.access_token)) {
    redirect('/auth/support-ended');
  }

  // An account with no company yet — signed up, not yet on a plan. Every page
  // below reads through a company, and the first one used to fail with "not a
  // member of any company". The welcome page says what is actually true.
  const { count: memberships } = await supabase
    .from('company_members')
    .select('company_id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((memberships ?? 0) === 0) {
    redirect('/welcome');
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
  const company = await myCompany(supabase);
  // Unread, for the bell. A count only; the page reads the rest.
  const [{ count: unread }, { data: membership }, { data: preferences }] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    supabase.from('company_members').select('role').eq('user_id', user.id).limit(1).maybeSingle(),
    supabase.from('user_preferences').select('display_name').eq('user_id', user.id).maybeSingle(),
  ]);
  const email = user.email ?? '';
  // The name set on the profile; until then, the address's first part reads as one.
  const local = email.split('@')[0] ?? '';
  const name =
    preferences?.display_name || (local.split(/[._-]/)[0] ?? local).replace(/^./, (first) => first.toUpperCase()) || 'You';

  return (
    <div className="shell">
      <Sidebar email={email} name={name} role={membership?.role ?? 'member'} plan={company?.plan ?? null} live={liveAvailable(company?.plan)} />
      <div className="shell-main">
        {banner ? (
          <div className="support-banner" role="status">
            <strong>{banner.headline}.</strong> {banner.detail}
          </div>
        ) : null}
        <header className="topbar">
          <form action="/search" method="get" className="topbar-search" role="search">
            <Icon name="search" size={18} />
            <input type="search" name="q" placeholder="Search what was said" aria-label="Search what was said" />
          </form>
          <FeedbackLink />
          <Link href="/notifications" className="bell" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
            <Icon name="bell" />
            {unread ? <span className="count">{unread > 99 ? '99+' : unread}</span> : null}
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
