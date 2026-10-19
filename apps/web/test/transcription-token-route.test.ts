/**
 * A transcription token is for one call (ADR 0022): a live call the caller
 * started and that has not ended. It used to be for no call at all, so
 * anyone with live minutes could open streams on our Deepgram account with
 * nothing attached to them. Deepgram is a stubbed fetch; nothing leaves the
 * test.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CALL = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';
const ME = 'u1';

let call: { added_by: string | null; captured_live: boolean; created_at: string } | null;
let lookedUp: unknown[];
let rpcCalls: string[];
let rateAllowed: boolean;
let minutesLeft: boolean;
let deepgram: string[];

/** Enough of PostgREST's builder for one lookup by id, which it remembers. */
const db = {
  from: (table: string) => {
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        lookedUp.push([table, column, value]);
        return chain;
      },
      maybeSingle: async () => ({ data: call, error: null }),
    };
    return chain;
  },
  rpc: async (name: string) => {
    rpcCalls.push(name);
    if (name === 'take_rate_limit_tokens') return { data: { allowed: rateAllowed, retry_after_seconds: 30 }, error: null };
    if (name === 'plan_has_allowance') return { data: minutesLeft, error: null };
    return { data: null, error: null };
  },
};

vi.mock('@/lib/supabase/caller', () => ({ caller: async () => ({ db, userId: ME }) }));
vi.mock('@/lib/live-input', () => ({ liveAllowedFor: async () => true }));

const { POST } = await import('@/app/api/live/transcription-token/route');

function ask(body: unknown) {
  return POST(
    new NextRequest('https://app.example.com/api/live/transcription-token', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

beforeEach(() => {
  vi.stubEnv('DEEPGRAM_API_KEY', 'dg-secret');
  call = { added_by: ME, captured_live: true, created_at: hoursAgo(0.01) };
  lookedUp = [];
  rpcCalls = [];
  rateAllowed = true;
  minutesLeft = true;
  deepgram = [];
  vi.stubGlobal('fetch', async (url: string) => {
    deepgram.push(url);
    return Response.json({ access_token: 'short', expires_in: 60 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/live/transcription-token', () => {
  it('grants a token for a live call the caller started that is still going', async () => {
    const response = await ask({ conversationId: CALL });

    expect(response.status).toBe(200);
    const granted = (await response.json()) as { token: string; url: string };
    expect(granted.token).toBe('short');
    expect(granted.url).toMatch(/^wss:\/\/api\.deepgram\.com\//);
    expect(lookedUp).toEqual([['conversations', 'id', CALL]]);
    expect(deepgram).toEqual(['https://api.deepgram.com/v1/auth/grant']);
  });

  it('tells an overlay that names no call to update, and asks Deepgram for nothing', async () => {
    for (const body of [{}, { conversationId: 'not-a-call' }, { conversationId: '../../../../etc' }, 'not json']) {
      const response = await ask(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expect.stringMatching(/^Update Tesserafy/) });
    }
    expect(lookedUp).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(deepgram).toEqual([]);
  });

  it('refuses a call that is not one the caller started live: a colleague’s, an imported one, one it cannot see', async () => {
    for (const row of [
      { added_by: 'u2', captured_live: true, created_at: hoursAgo(0.01) },
      { added_by: ME, captured_live: false, created_at: hoursAgo(0.01) },
      null,
    ]) {
      call = row;
      const response = await ask({ conversationId: CALL });
      expect(response.status, JSON.stringify(row)).toBe(404);
    }
    expect(rpcCalls).toEqual([]);
    expect(deepgram).toEqual([]);
  });

  it('refuses a call that has ended', async () => {
    call = { added_by: ME, captured_live: true, created_at: hoursAgo(13) };

    const response = await ask({ conversationId: CALL });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: expect.stringMatching(/ended/) });
    expect(deepgram).toEqual([]);
  });

  it('keeps the rate limit and the live minutes in front of Deepgram', async () => {
    rateAllowed = false;
    expect((await ask({ conversationId: CALL })).status).toBe(429);

    rateAllowed = true;
    minutesLeft = false;
    expect((await ask({ conversationId: CALL })).status).toBe(402);

    expect(deepgram).toEqual([]);
  });
});
