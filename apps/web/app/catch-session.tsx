'use client';

import { useEffect } from 'react';

/**
 * A session that arrived at the wrong door.
 *
 * Supabase does not reject a `redirect_to` it has not been told to allow — it
 * silently substitutes the project's site URL. So a link generated for
 * `/auth/confirm` lands on `/` instead, with the tokens still in the fragment,
 * and `/` is a server component that redirects to a page requiring the session
 * those tokens would have created. The person ends up on the login form
 * holding a valid session they cannot use, and nothing anywhere says why.
 *
 * That was measured, not imagined: asking for `…/auth/confirm` came back with
 * `redirect_to=…` pointing at the bare origin.
 *
 * Adding the URL to the allow-list is the actual fix and belongs in the
 * project's settings. This is the part that survives somebody forgetting: the
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
