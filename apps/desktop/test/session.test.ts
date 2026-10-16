/**
 * Keeping a sign-in through a network that is not there, and letting it go
 * when Auth says it is over. Auth is a stubbed fetch; nothing leaves the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session, type Store } from '../src/main/session';

const CONFIG = { supabaseUrl: 'https://auth.test', publishableKey: 'pk', usernameDomain: 'example.test' };
const TOKENS = { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600, user: { email: 'ada@example.test' } };

function memoryStore(saved: string | null): Store & { saved: string | null } {
  const store = {
    saved,
    persistent: true,
    read: async () => store.saved,
    write: async (token: string) => {
      store.saved = token;
    },
    clear: async () => {
      store.saved = null;
    },
  };
  return store;
}

/** Auth answering each token request in turn; the client config always answers. */
function auth(...answers: ('down' | number)[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (url.pathname === '/auth/client-config') return Response.json(CONFIG);
      const answer = answers.shift() ?? 'down';
      if (answer === 'down') throw new TypeError('fetch failed');
      return answer === 200 ? Response.json(TOKENS) : new Response('{}', { status: answer });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('a saved sign-in', () => {
  it('is kept when Auth cannot be reached at start-up, and resumes once it can', async () => {
    auth('down', 200);
    const store = memoryStore('refresh-1');
    const session = new Session('https://app.test', store);

    expect(await session.resume()).toBe(false);
    expect(store.saved).toBe('refresh-1');
    expect(session.waiting).toBe(true);

    expect(await session.bearer()).toBe('access-2');
    expect(session.signedInAs).toBe('ada@example.test');
    expect(store.saved).toBe('refresh-2');
  });

  it('is kept through an Auth outage (a 503), as through no network', async () => {
    auth(503);
    const store = memoryStore('refresh-1');

    expect(await new Session('https://app.test', store).resume()).toBe(false);
    expect(store.saved).toBe('refresh-1');
  });

  it('is forgotten when Auth refuses it, and the overlay is told it is signed out', async () => {
    auth(200, 400);
    const store = memoryStore('refresh-1');
    let now = 0;
    const session = new Session('https://app.test', store, () => now);
    const signedOut = vi.fn();
    session.onSignedOut = signedOut;

    expect(await session.resume()).toBe(true);
    now = 3_600_000; // the access token has expired; its renewal is refused
    expect(await session.bearer()).toBeNull();
    expect(store.saved).toBeNull();
    expect(session.waiting).toBe(false);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('says a password sign-in could not reach Tesserafy, rather than that the password was wrong', async () => {
    auth('down');
    const result = await new Session('https://app.test', memoryStore(null)).signIn('ada', 'secret');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/Could not reach Tesserafy/);
  });
});
