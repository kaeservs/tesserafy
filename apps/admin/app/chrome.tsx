import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';

/**
 * The band and the navigation, on every page.
 *
 * The band is not decoration. This console reads across every tenant and can
 * open a session as anyone, and the single most likely mistake is forgetting
 * which window you are in. So it says so, in the colour of a warning, above
 * everything else.
 */
/**
 * How many owners are waiting on an answer. There is no email to tell the
 * operator, so the nav does — on every page, as the thing most likely to be
 * forgotten. Nothing when none are waiting, and nothing if the count cannot
 * be read: a missing badge is not worth breaking a page for.
 */
async function RequestCount() {
  const db = await createClient();
  const { data } = await db.rpc('admin_access_requests');
  const waiting = (data ?? []).length;
  return waiting > 0 ? <span className="tag open">{waiting}</span> : null;
}

export function Chrome({ email, children }: { email: string; children: ReactNode }) {
  return (
    <>
      <div className="band">
        <span>
          <strong>OPERATOR CONSOLE</strong> — reads across every tenant. Everything here is
          recorded.
        </span>
        <span>{email}</span>
      </div>
      <nav>
        <Link href="/">Overview</Link>
        <Link href="/companies">Companies</Link>
        <Link href="/people">People</Link>
        <Link href="/onboard">
          Add people <RequestCount />
        </Link>
        <Link href="/history">Access history</Link>
        <span className="spacer" />
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
