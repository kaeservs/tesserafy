/**
 * The site and the app on hosts of their own: tesserafy.com (and www) is the
 * landing page, app.tesserafy.com everything a person signs in to. One
 * deployment serves both; this says which requests belong on which host.
 *
 * Off until NEXT_PUBLIC_APP_URL is set (https://app.tesserafy.com), so the
 * code can ship before the app's domain resolves. Any other host — the
 * vercel.app address the overlay uses, previews, localhost — is left alone.
 */

/** The landing page's own hosts. Brand domains, not secrets. */
const SITE_HOSTS = new Set(['tesserafy.com', 'www.tesserafy.com']);

/** What the landing page's hosts serve themselves; anything else is the app's. */
const SITE_PATHS = new Set(['/', '/terms', '/privacy', '/robots.txt', '/sitemap.xml']);

function hostname(host: string | null): string | null {
  return host ? (host.split(':')[0] ?? '').toLowerCase() : null;
}

function appOrigin(appUrl: string | undefined): URL | null {
  if (!appUrl) return null;
  try {
    return new URL(appUrl);
  } catch {
    return null;
  }
}

/**
 * Where a request on the landing page's host belongs instead, or null to serve
 * it here. The API stays wherever it is called: a webhook or the overlay may
 * be pointed at any host, and a redirect is not an answer a program expects.
 */
export function appRedirect(url: URL, host: string | null, appUrl: string | undefined): URL | null {
  const app = appOrigin(appUrl);
  const name = hostname(host);
  if (!app || !name || !SITE_HOSTS.has(name) || name === app.hostname) return null;
  const path = url.pathname;
  if (SITE_PATHS.has(path) || path.startsWith('/api/')) return null;
  // The path is set on the app's address, never read as a link relative to
  // it: read that way, `//evil.example/x` is another site's address, and the
  // landing page redirected anyone who followed such a link there. Next's own
  // server rewrites `//` and `\` before this runs; whether every edge in front
  // of it does is not something this code can know.
  const target = new URL(app.origin);
  target.pathname = path;
  target.search = url.search;
  return target.origin === app.origin ? target : null;
}

/**
 * Whether a request was sent by a page on another host: its Origin names a
 * host other than the one it was sent to. `null`, the Origin of a sandboxed
 * frame or a local file, is another host. No Origin at all is not: a browser
 * sends one with every POST, PUT, PATCH and DELETE, so a request without one
 * was sent by a program — the overlay's main process, Stripe — and not by a
 * page acting with a visitor's cookies.
 */
export function fromAnotherHost(origin: string | null, host: string | null): boolean {
  if (origin === null) return false;
  if (!host) return true;
  try {
    const from = new URL(origin);
    // The request's host read the way the Origin was, so a default port, a
    // capital letter or a punycoded name compares equal to itself.
    return new URL(`${from.protocol}//${host}`).host !== from.host;
  } catch {
    return true;
  }
}

/** Whether this is the app's own host, where `/` is the dashboard rather than the landing page. */
export function isAppHost(host: string | null, appUrl: string | undefined): boolean {
  const app = appOrigin(appUrl);
  return app !== null && hostname(host) === app.hostname;
}

/** An address in the app: absolute once it has a host of its own, else on this one. */
export function appHref(path: string, appUrl: string | undefined): string {
  const app = appOrigin(appUrl);
  return app ? new URL(path, app.origin).toString() : path;
}
