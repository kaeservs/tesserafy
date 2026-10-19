/**
 * Keeping a sign-in through a network that is not there, and letting it go
 * when Auth says it is over; a renewal that overlaps a sign-in or a sign-out;
 * signing out on the server; and where a password may be sent. Auth is a
 * stubbed fetch; nothing leaves the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupabaseAuth, Session, type Store } from '../src/main/session';

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

/** Tokens for one person's nth session: `ada-access-2`, `ada-refresh-2`. */
function account(name: string, n: number) {
  return { access_token: `${name}-access-${n}`, refresh_token: `${name}-refresh-${n}`, expires_in: 3600, user: { email: `${name}@example.test` } };
}

interface Sent {
  host: string;
  path: string;
  authorization: string | null;
  body: { refresh_token?: string; email?: string; password?: string } | null;
}

/**
 * Auth answering each request by what it asks — a refresh by the token it
 * presents — so a test can hold one answer back. The client config always
 * answers; everything else is kept, to see what was sent where.
 */
function routes(answer: (request: Sent) => Response | 'down' | Promise<Response>, config: object = CONFIG): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit = {}) => {
      if (url.pathname === '/auth/client-config') return Response.json(config);
      const headers = (init.headers ?? {}) as Record<string, string>;
      const request: Sent = {
        host: url.host,
        path: `${url.pathname}${url.search}`,
        authorization: headers['authorization'] ?? null,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as Sent['body']) : null,
      };
      sent.push(request);
      const answered = await answer(request);
      if (answered === 'down') throw new TypeError('fetch failed');
      return answered;
    }),
  );
  return sent;
}

function held() {
  let answer: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

const isLogout = (request: Sent) => request.path.startsWith('/auth/v1/logout');

describe('a renewal under way when someone signs in or out', () => {
  it('cannot make the overlay the last account again: the new one stays signed in, with its token saved', async () => {
    const adaRenewal = held();
    const sent = routes((request) => {
      if (request.path === '/auth/v1/token?grant_type=password') return Response.json(account('bob', 1));
      if (request.body?.refresh_token === 'ada-refresh-1') return Response.json(account('ada', 2));
      if (request.body?.refresh_token === 'ada-refresh-2') return adaRenewal.promise;
      if (request.body?.refresh_token === 'bob-refresh-1') return Response.json(account('bob', 2));
      return new Response('{}', { status: 400 });
    });
    const store = memoryStore('ada-refresh-1');
    let now = 0;
    const session = new Session('https://app.test', store, () => now);
    expect(await session.resume()).toBe(true);

    now = 3_600_000; // Ada's token has expired, and Auth is slow to renew it
    const adaAsked = session.bearer();
    expect(await session.signIn('bob', 'secret')).toEqual({ ok: true, email: 'bob@example.test' });

    // Bob's token expiring while Ada's renewal is still out: Bob gets a
    // renewal of his own, not a share of hers.
    now = 7_200_000;
    expect(await session.bearer()).toBe('bob-access-2');
    expect(sent.filter((request) => request.body?.refresh_token === 'bob-refresh-1')).toHaveLength(1);

    adaRenewal.answer(Response.json(account('ada', 3)));
    expect(await adaAsked).toBeNull();
    expect(session.signedInAs).toBe('bob@example.test');
    expect(store.saved).toBe('bob-refresh-2');
    expect(await session.bearer()).toBe('bob-access-2');
  });

  it('cannot undo a sign-out: it stays signed out, with nothing saved', async () => {
    const adaRenewal = held();
    const sent = routes((request) => {
      if (request.path === '/api/detect') return new Response('{}', { status: 401 });
      if (isLogout(request)) return new Response(null, { status: 204 });
      if (request.body?.refresh_token === 'ada-refresh-1') return Response.json(account('ada', 2));
      if (request.body?.refresh_token === 'ada-refresh-2') return adaRenewal.promise;
      return new Response('{}', { status: 400 });
    });
    const store = memoryStore('ada-refresh-1');
    const session = new Session('https://app.test', store);
    expect(await session.resume()).toBe(true);

    // The API turns a call away, so the session renews; Auth is slow to answer.
    const calling = session.fetch('/api/detect');
    await vi.waitFor(() => expect(sent.some((request) => request.body?.refresh_token === 'ada-refresh-2')).toBe(true));
    await session.signOut();
    adaRenewal.answer(Response.json(account('ada', 3)));

    expect((await calling)?.status).toBe(401);
    expect(session.signedInAs).toBeNull();
    expect(session.waiting).toBe(false);
    expect(store.saved).toBeNull();
    expect(await session.bearer()).toBeNull();
    expect(sent.filter(isLogout).map((request) => request.authorization)).toEqual(['Bearer ada-access-2']);
  });
});

describe('signing out', () => {
  it('ends the session on the server with a fresh token when the one held expired while idle', async () => {
    const sent = routes((request) => {
      if (isLogout(request)) return new Response(null, { status: 204 });
      if (request.body?.refresh_token === 'ada-refresh-1') return Response.json(account('ada', 2));
      if (request.body?.refresh_token === 'ada-refresh-2') return Response.json(account('ada', 3));
      return new Response('{}', { status: 400 });
    });
    const store = memoryStore('ada-refresh-1');
    let now = 0;
    const session = new Session('https://app.test', store, () => now);
    expect(await session.resume()).toBe(true);

    now = 3_600_000; // an hour idle: Auth would refuse a logout with the old token
    await session.signOut();

    expect(sent.filter(isLogout).map((request) => request.authorization)).toEqual(['Bearer ada-access-3']);
    expect(session.signedInAs).toBeNull();
    expect(store.saved).toBeNull();
  });

  it('ends a sign-in that was still waiting for Auth at start-up, on the server too once Auth answers', async () => {
    let up = false;
    const sent = routes((request) => {
      if (!up) return 'down';
      if (isLogout(request)) return new Response(null, { status: 204 });
      if (request.body?.refresh_token === 'ada-refresh-1') return Response.json(account('ada', 2));
      return new Response('{}', { status: 400 });
    });
    const store = memoryStore('ada-refresh-1');
    const session = new Session('https://app.test', store);
    expect(await session.resume()).toBe(false);
    expect(session.waiting).toBe(true);

    up = true;
    await session.signOut();

    expect(sent.filter(isLogout).map((request) => request.authorization)).toEqual(['Bearer ada-access-2']);
    expect(session.waiting).toBe(false);
    expect(store.saved).toBeNull();
  });

  it('still signs out here when Auth cannot be reached at all', async () => {
    const sent = routes(() => 'down');
    const store = memoryStore('ada-refresh-1');
    const session = new Session('https://app.test', store);
    expect(await session.resume()).toBe(false);

    await session.signOut();

    expect(sent.filter(isLogout)).toEqual([]);
    expect(session.waiting).toBe(false);
    expect(store.saved).toBeNull();
  });
});

describe('where a password may go', () => {
  it('sends none to an Auth address it does not trust, and says it could not reach Tesserafy', async () => {
    const sent = routes(() => Response.json(account('ada', 1)), { ...CONFIG, supabaseUrl: 'https://auth.attacker.test' });
    const result = await new Session('https://app.test', memoryStore(null), Date.now, null, isSupabaseAuth).signIn('ada', 'secret');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/could not reach Tesserafy/i);
    expect(sent).toEqual([]);
  });

  it('sends no refresh token there either: a saved sign-in is kept, and signing out sends nothing', async () => {
    const sent = routes(() => Response.json(account('ada', 2)), { ...CONFIG, supabaseUrl: 'http://abc.supabase.co' });
    const store = memoryStore('ada-refresh-1');
    const session = new Session('https://app.test', store, Date.now, null, isSupabaseAuth);

    expect(await session.resume()).toBe(false);
    expect(session.waiting).toBe(true);
    expect(store.saved).toBe('ada-refresh-1');
    await session.signOut();
    expect(sent).toEqual([]);
  });

  it('signs in through Supabase Auth over https', async () => {
    const sent = routes(() => Response.json(account('ada', 1)), { ...CONFIG, supabaseUrl: 'https://abc.supabase.co' });
    const session = new Session('https://app.test', memoryStore(null), Date.now, null, isSupabaseAuth);

    expect(await session.signIn('ada', 'secret')).toEqual({ ok: true, email: 'ada@example.test' });
    expect(sent.map((request) => request.host)).toEqual(['abc.supabase.co']);
  });

  it('takes nothing else for Supabase Auth', () => {
    expect(isSupabaseAuth(new URL('https://abc.supabase.co'))).toBe(true);
    for (const address of [
      'http://abc.supabase.co',
      'https://supabase.co',
      'https://abcsupabase.co',
      'https://abc.supabase.co.attacker.test',
      'https://attacker.test/abc.supabase.co',
    ]) {
      expect(isSupabaseAuth(new URL(address)), address).toBe(false);
    }
  });
});
