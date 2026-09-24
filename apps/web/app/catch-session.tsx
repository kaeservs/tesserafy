'use client';

import { useEffect } from 'react';

/**
 * A session that arrived at the wrong door.
 *
 * Supabase sends a sign-in link to the project's Site URL whenever the
 * request names no redirect, or names one missing from the allow-list. The
 * Site URL is `/`, a server component that redirects to a page requiring the
 * session those tokens would have created — so the person ends up on the login
 * form holding a valid session they cannot use, and nothing says why.
 *
 * It happened. The operator console once nested `redirect_to` where the REST
 * endpoint does not read it, every link fell back to `/`, and the cause was
 * first mistaken for the allow-list. Neither a correct request nor a correct
 * allow-list is something this component can check, so it covers both: the
 * fragment is carried to the page that knows what to do with it, from wherever
 * it landed. It costs one effect that almost always finds nothing.
 *
 * It only ever moves a fragment this application's own sign-in produced, to
 * this application's own confirm page. It does not read it, store it, or send
 * it anywhere.
 */
export function CatchSession() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('access_token=') && !hash.includes('error_code=')) return;
    if (window.location.pathname.startsWith('/auth/confirm')) return;

    // replace(), not push(): the fragment should not be left behind in history
    // as a back-button destination that signs somebody in again.
    window.location.replace(`/auth/confirm${hash}`);
  }, []);

  return null;
}
