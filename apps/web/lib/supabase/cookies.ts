import type { CookieOptionsWithName } from '@supabase/ssr';

/**
 * How every Supabase client in this app writes the session cookie.
 *
 * @supabase/ssr's own defaults are SameSite=Lax, readable by script, kept 400
 * days and not Secure: a browser would send the session over plain http to
 * this host, where anyone on the network between it and the visitor can read
 * it. Secure keeps it to https.
 *
 * Always Secure, never decided per request. A flag worked out from a
 * forwarded header is one that a proxy which leaves the header off turns off
 * without anyone noticing. Running locally loses nothing by it: browsers
 * count http://localhost and http://127.0.0.1 as secure, and Chromium keeps a
 * Secure cookie on both whether the server or a script sets it (checked) —
 * which covers `pnpm dev`, the local production build, `pnpm e2e` and local
 * Supabase's links to 127.0.0.1. What does lose is plain http under any other
 * name, such as a phone on the network reaching a laptop's dev server by its
 * address: the cookie is dropped and signing in does not stick. Use localhost
 * or https for that.
 *
 * SameSite stays Lax: a link in an email and Stripe's return to the app are
 * navigations from another site, and arrive signed in. HttpOnly stays off:
 * /auth/confirm writes the session from script, and the browser client reads
 * it back the same way.
 */
export const SESSION_COOKIE: CookieOptionsWithName = { secure: true, sameSite: 'lax' };
