import type { NextRequest } from 'next/server';

/**
 * An absolute URL on the host the visitor actually used.
 *
 * `request.nextUrl.origin` can normalise 127.0.0.1 to localhost. Auth cookies
 * are per host, so redirecting across that boundary silently drops the
 * session. Vercel sets x-forwarded-host and x-forwarded-proto.
 */
export function siteUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  return new URL(path, host ? `${proto}://${host}` : request.nextUrl.origin);
}
