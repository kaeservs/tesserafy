import type { CookieOptionsWithName } from '@supabase/ssr';

/**
 * How the console's Supabase clients write the operator's session cookie.
 *
 * @supabase/ssr's own defaults are SameSite=Lax, readable by script, kept 400
 * days and not Secure: a browser would send an operator's session over plain
 * http to this host, where anyone on the network between them can read it —
 * and an operator's session reads every tenant. Secure keeps it to https.
 *
 * Always Secure, never decided per request: a flag worked out from a
 * forwarded header is one that a proxy which leaves the header off turns off
 * without anyone noticing. Browsers count http://localhost as secure and
 * keep a Secure cookie there (checked in Chromium), so the console on port
 * 3001 still signs in locally; plain http under any other name does not.
 *
 * SameSite stays Lax and HttpOnly stays as it was, the same as the web app's
 * (apps/web/lib/supabase/cookies.ts).
 */
export const SESSION_COOKIE: CookieOptionsWithName = { secure: true, sameSite: 'lax' };
