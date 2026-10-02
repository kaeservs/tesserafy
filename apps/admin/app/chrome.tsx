import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import { ConsoleSidebar } from './console-sidebar';

/**
 * The band and the navigation, on every page.
 *
 * The band is not decoration. This console reads across every tenant and can
 * open a session as anyone, and the single most likely mistake is forgetting
 * which window you are in. So it says so, in the colour of a warning, above
 * everything else.
 */
/**
 * How many owners are waiting on an answer, and how much feedback nobody has
 * looked at. There is no email to tell the operator, so the sidebar does — on
 * every page, as the things most likely to be forgotten. Zero if a count
 * cannot be read: a missing badge is not worth breaking a page for.
 */
async function waitingCounts(): Promise<{ requests: number; feedback: number }> {
  const db = await createClient();
  const [{ data: requests }, { count: feedback }] = await Promise.all([
    db.rpc('admin_access_requests'),
    db.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ]);
  return { requests: (requests ?? []).length, feedback: feedback ?? 0 };
}

export async function Chrome({ email, children }: { email: string; children: ReactNode }) {
  const counts = await waitingCounts();
  return (
    <>
      <div className="band">
        <span>
          <strong>OPERATOR CONSOLE</strong> — reads across every tenant. Everything here is
          recorded.
        </span>
        <span>{email}</span>
      </div>
      <div className="shell">
        <ConsoleSidebar
          counts={counts}
          footer={
            <>
              <span className="who">{email}</span>
              <form action={signOut}>
                <button type="submit" className="link-button">
                  Sign out
                </button>
              </form>
            </>
          }
        />
        <main>{children}</main>
      </div>
    </>
  );
}
