import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOut } from './actions';

/**
 * The band and the navigation, on every page.
 *
 * The band is not decoration. This console reads across every tenant and can
 * open a session as anyone, and the single most likely mistake is forgetting
 * which window you are in. So it says so, in the colour of a warning, above
 * everything else.
 */
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
        <Link href="/">People</Link>
        <Link href="/companies">Companies</Link>
        <Link href="/onboard">Add people</Link>
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
