/**
 * The limiter, and the question it exists to answer wrongly-but-safely.
 *
 * Most of the counting is in Postgres, where it has to be. What lives here is
 * the decision made when the counting is unavailable, and that decision is the
 * whole reason this file exists: a limiter that fails open is not a limiter
 * during exactly the incident it was built for.
 */
import { describe, expect, it } from 'vitest';
import { allowance, LIMITS, tooMany } from '../lib/rate-limit';

type RpcResult = { data: unknown; error: { message: string } | null };

/** Just enough Supabase to answer one rpc call. */
function fakeDb(result: RpcResult, seen?: { bucket?: string; windows?: unknown }) {
  return {
    rpc: (_name: string, args: Record<string, unknown>) => {
      if (seen) {
        seen.bucket = args['p_bucket'] as string;
        seen.windows = args['p_windows'];
      }
      return Promise.resolve(result);
    },
  } as never;
}

describe('when the counter answers', () => {
  it('allows a request inside the limit', async () => {
    const result = await allowance(
      fakeDb({ data: { allowed: true, retry_after_seconds: 0 }, error: null }),
      'api/detect',
    );

    expect(result.allowed).toBe(true);
  });

  it('refuses one past it, and says how long to wait', async () => {
    const result = await allowance(
      fakeDb({ data: { allowed: false, retry_after_seconds: 42 }, error: null }),
      'api/detect',
    );

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });

  it('never tells a caller to retry in zero seconds', async () => {
    // A client that is told to wait for nothing retries immediately, which is
    // the behaviour this endpoint is trying to stop.
    const result = await allowance(
      fakeDb({ data: { allowed: false, retry_after_seconds: 0 }, error: null }),
      'api/detect',
    );

    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('sends both windows in one call', async () => {
    const seen: { bucket?: string; windows?: unknown } = {};
    await allowance(fakeDb({ data: { allowed: true }, error: null }, seen), 'api/detect');

    expect(seen.bucket).toBe('api/detect');
    expect(seen.windows).toHaveLength(2);
  });
});

describe('when the counter does not answer', () => {
  it('refuses, because the alternative is an unbounded bill', async () => {
    const result = await allowance(
      fakeDb({ data: null, error: { message: 'connection refused' } }),
      'api/detect',
    );

    expect(result.allowed).toBe(false);
  });

  it('treats a missing answer as a refusal rather than a yes', async () => {
    const result = await allowance(fakeDb({ data: null, error: null }), 'api/detect');

    // No data and no error should not read as permission: the call may have
    // succeeded without taking a token, and a token we cannot confirm was
    // taken is not a token.
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe('an endpoint with no configured limit', () => {
  it('is not blocked by the limiter, and costs it no round trip', async () => {
    let called = false;
    const db = {
      rpc: () => {
        called = true;
        return Promise.resolve({ data: null, error: null });
      },
    } as never;

    const result = await allowance(db, 'api/criteria');

    expect(result.allowed).toBe(true);
    expect(called, 'an unlimited endpoint should not pay for a check').toBe(false);
  });
});

describe('what the caller is told', () => {
  it('describes an hourly window in words', async () => {
    const body = (await tooMany('api/transcripts', 60).json()) as { error: string };

    expect(body.error).toContain('6 an hour');
    expect(body.error).toContain('10 a day');
  });

  it('answers 429 with a Retry-After header', () => {
    const response = tooMany('api/detect', 17);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
  });

  it('names the actual limits rather than refusing mutely', async () => {
    // "You are being rate limited" with no number is indistinguishable from
    // the product being broken.
    const body = (await tooMany('api/suggest', 5).json()) as { error: string };

    expect(body.error).toContain('20 every 60s');
    expect(body.error).toContain('600 a day');
    expect(body.error).toContain('5s');
  });
});

describe('the limits themselves', () => {
  it('bounds the day as well as the minute', () => {
    // A minute window alone permits eighty-six thousand calls a day, which is
    // a bill, not a limit.
    for (const [bucket, windows] of Object.entries(LIMITS)) {
      const day = windows.find((window) => window.seconds === 86_400);
      expect(day, `${bucket} has no daily ceiling`).toBeDefined();

      // The daily ceiling must actually bind: tighter than the shortest window
      // sustained all day, or it is a number that never matters.
      const shortest = [...windows].sort((a, b) => a.seconds - b.seconds)[0]!;
      expect(day!.limit).toBeLessThan(shortest.limit * (86_400 / shortest.seconds));
    }
  });
});
