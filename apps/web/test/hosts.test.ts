/**
 * tesserafy.com is the landing page and app.tesserafy.com the app, served by
 * one deployment. These pin which requests move host, that the API never
 * does, and that nothing moves until NEXT_PUBLIC_APP_URL is set.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHref, appRedirect, isAppHost } from '../lib/hosts';

vi.mock('../lib/env', () => ({
  publicSupabaseEnv: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_x' }),
}));

let signedIn = false;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null }, error: null }),
    },
  }),
}));

const APP = 'https://app.tesserafy.com';

function at(path: string): URL {
  return new URL(`https://www.tesserafy.com${path}`);
}

describe('appRedirect', () => {
  it('keeps the landing page, its legal pages and the API on the landing page’s host', () => {
    for (const path of ['/', '/terms', '/privacy', '/api/stripe/webhook', '/api/live/setup']) {
      expect(appRedirect(at(path), 'www.tesserafy.com', APP), path).toBeNull();
    }
  });

  it('sends sign-in, sign-up and the dashboard to the app, path and query kept', () => {
    expect(appRedirect(at('/signup'), 'www.tesserafy.com', APP)?.toString()).toBe('https://app.tesserafy.com/signup');
    expect(appRedirect(at('/login?next=%2Fask'), 'tesserafy.com', APP)?.toString()).toBe(
      'https://app.tesserafy.com/login?next=%2Fask',
    );
    expect(appRedirect(at('/auth/confirm?token_hash=t&type=email'), 'www.tesserafy.com', APP)?.toString()).toBe(
      'https://app.tesserafy.com/auth/confirm?token_hash=t&type=email',
    );
    expect(appRedirect(at('/dashboard'), 'WWW.TESSERAFY.COM:443', APP)?.toString()).toBe('https://app.tesserafy.com/dashboard');
  });

  it('leaves every other host alone: the overlay’s vercel.app address, previews, the app itself', () => {
    for (const host of ['web-beta-khaki-cxdkp6udxk.vercel.app', 'localhost:3000', 'app.tesserafy.com', null]) {
      expect(appRedirect(at('/dashboard'), host, APP), String(host)).toBeNull();
    }
  });

  it('does nothing until the app has an address of its own', () => {
    expect(appRedirect(at('/dashboard'), 'www.tesserafy.com', undefined)).toBeNull();
    expect(appRedirect(at('/dashboard'), 'www.tesserafy.com', 'not a url')).toBeNull();
  });
});

describe('isAppHost and appHref', () => {
  it('knows the app’s host, and links to it absolutely once it has one', () => {
    expect(isAppHost('app.tesserafy.com', APP)).toBe(true);
    expect(isAppHost('www.tesserafy.com', APP)).toBe(false);
    expect(isAppHost('app.tesserafy.com', undefined)).toBe(false);
    expect(appHref('/signup', APP)).toBe('https://app.tesserafy.com/signup');
    expect(appHref('/signup', undefined)).toBe('/signup');
  });
});

describe('the proxy, by host', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function visit(host: string, path: string): Promise<Response> {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP);
    const { proxy } = await import('../proxy');
    return proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  }

  it('sends the landing page’s sign-in to the app', async () => {
    const response = await visit('www.tesserafy.com', '/login');
    expect(response.headers.get('location')).toBe('https://app.tesserafy.com/login');
  });

  it('serves the landing page on its own host', async () => {
    signedIn = false;
    const response = await visit('www.tesserafy.com', '/');
    expect(response.headers.get('location')).toBeNull();
  });

  it('opens the app’s root on sign-in, or on the dashboard once signed in', async () => {
    signedIn = false;
    expect((await visit('app.tesserafy.com', '/')).headers.get('location')).toBe('https://app.tesserafy.com/login');
    signedIn = true;
    expect((await visit('app.tesserafy.com', '/')).headers.get('location')).toBe('https://app.tesserafy.com/dashboard');
  });
});
