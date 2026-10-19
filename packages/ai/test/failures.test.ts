/**
 * Classifying a failure, and the two mistakes that make the table useless.
 *
 * Calling weather a bug wakes somebody up for nothing, and doing that twice
 * teaches them to ignore the table. Calling a bug weather is how three tiers
 * stay down for four merges. So the tests that matter are the ones on either
 * side of that line.
 *
 * The scrub tests matter for a different reason: they are the only thing
 * standing between an upstream error that quotes the request back at us and a
 * row containing a customer's sentence or a live key.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import { classify, recordFailure, scrub } from '../src/telemetry/failures';

/** What the Anthropic SDK throws: an Error carrying the HTTP status. */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe('what needs a person today', () => {
  it('calls a rejected request our bug', () => {
    // The exact failure that hid for four merges.
    const result = classify(apiError(400, 'temperature is deprecated for this model'));

    expect(result.kind).toBe('model_rejected');
    expect(result.status).toBe(400);
  });

  it('calls running out of credit billing, and tells the customer nothing about our account', () => {
    const result = classify(
      apiError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
    );
    expect(result.kind).toBe('billing');
    expect(result.message).toMatch(/credit balance/);
    expect(result.said).not.toMatch(/credit|Anthropic/i);
    // Anything else is told as it was recorded, scrubbed.
    expect(classify(apiError(400, 'temperature is deprecated')).said).toBe('temperature is deprecated');
  });

  it('calls a refused key our bug too, because waiting will not fix it', () => {
    expect(classify(apiError(401, 'invalid x-api-key')).kind).toBe('model_rejected');
  });

  it('calls our own database refusing us its own kind', () => {
    // A PostgREST error: five-character SQLSTATE, not an HTTP status.
    const result = classify({
      code: '23514',
      details: null,
      message: 'insight_evidence_keeps_insight_backed',
    });

    expect(result.kind).toBe('database');
  });
});

describe('what is an incident', () => {
  it("calls another company's row where one company's was asked for its own kind, and tells the customer nothing of it", () => {
    const breach = Object.assign(new Error('retrieve() got a row for company b'), { name: 'TenantBoundaryViolation' });
    const result = classify(breach);

    expect(result.kind).toBe('tenant_boundary');
    expect(result.said).not.toContain('company b');
  });
});

describe('what fixes itself', () => {
  it('calls an overloaded model weather', () => {
    expect(classify(apiError(529, 'overloaded_error')).kind).toBe('model_unavailable');
  });

  it('puts rate limiting with the weather, not with the bugs', () => {
    // 429 is the upstream saying "not now", not "not like that".
    expect(classify(apiError(429, 'rate_limit_error')).kind).toBe('model_unavailable');
  });

  it('calls a request that never landed weather', () => {
    expect(classify(new Error('fetch failed')).kind).toBe('model_unavailable');
    expect(classify(new Error('connect ETIMEDOUT 1.2.3.4:443')).kind).toBe('model_unavailable');
  });
});

describe('what came from the caller', () => {
  it('separates a malformed request from a broken product', () => {
    const zod = Object.assign(new Error('expected string, received number'), { name: 'ZodError' });

    expect(classify(zod).kind).toBe('input');
  });
});

describe('what it does not know', () => {
  it('says so rather than guessing', () => {
    expect(classify(new Error('something happened')).kind).toBe('unknown');
  });

  it('survives something that is not an error at all', () => {
    expect(classify('just a string').kind).toBe('unknown');
    expect(classify(undefined).message.length).toBeGreaterThan(0);
  });
});

describe('what must stay readable', () => {
  it('keeps a row id whole, digits and all, so the failure can be looked up', () => {
    const id = 'e4778f12-3456-4a71-9fff-cb3afc3eb57b';
    expect(scrub(`record_segment_embeddings: conversation ${id} not found`)).toContain(id);
  });

  it('while a phone number beside it is still masked', () => {
    const said = scrub('conversation e4778f12-3456-4a71-9fff-cb3afc3eb57b: call +44 20 7946 0958');
    expect(said).toContain('e4778f12-3456-4a71-9fff-cb3afc3eb57b');
    expect(said).not.toContain('7946');
  });

  it('does not take an ordinary word for a key because of the word before it', () => {
    // The credential patterns that look at context: after Basic, Bearer or
    // an authorization header, and in a URL. Each of these is read whole.
    for (const said of [
      'Basic authentication is not enabled for this account',
      'the Basic plan has no imports left this month',
      'Token expired; sign in again',
      'bearer token missing',
      'Missing authorization header',
      'authorization: missing',
      'authorization: invalid_request_error',
      'GET https://example.com:8443/path?to=x failed',
      'see https://docs.example.com/errors#auth-12 for details',
      `sha256 ${'ab'.repeat(32)} does not match`,
    ]) {
      expect(scrub(said)).toBe(said);
    }
  });
});

describe('what must never reach the row', () => {
  it('removes an API key the upstream quoted back', () => {
    const said = scrub('401 invalid x-api-key: sk-ant-api03-AbC123_xyz-QQ');

    expect(said).not.toContain('sk-ant');
    expect(said).toContain('[credential]');
  });

  it('removes a service-role key, which is a JWT and is live', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijk';

    expect(scrub(`JWT rejected: ${jwt}`)).not.toContain('eyJhbGciOi');
  });

  it('removes a bearer token without eating the word bearer', () => {
    // Assembled rather than written out. A fixture that looks like a real
    // token is one that secret scanning blocks the push on, and one that a
    // reader has to check is fake — so it is built from pieces and says so.
    const token = `gh${'p'}_${'A'.repeat(36)}`;
    const said = scrub(`Authorization: Bearer ${token} failed`);

    expect(said).not.toContain(token);
    expect(said).toContain('Bearer');
    expect(said).toContain('[credential]');
  });

  it('removes the keys of the other services the web app talks to', () => {
    // Assembled from pieces, as above: none of these is a real key.
    const keys = [
      `${'sk'}_${'live'}_${'A1b2'.repeat(6)}`,
      `${'rk'}_${'test'}_${'Z9y8'.repeat(6)}`,
      `${'whsec'}_${'Q'.repeat(32)}`,
      `${'re'}_${'Abcd1234'}_${'Efgh5678ijkl'}`,
      `${'pat'}-${'na1'}-${'0123abcd'}-${'4567-89ab-cdef-0123456789ab'}`,
    ];
    for (const key of keys) {
      const said = scrub(`upstream said 401 for ${key} just now`);
      expect(said).not.toContain(key);
      expect(said).toContain('[credential]');
    }
  });

  it('removes the keys of the integrations, live transcription and Supabase’s newer secret', () => {
    // Assembled from pieces, as above: none of these is a real key.
    const keys = [
      `${'sb'}_${'secret'}_${'N7UND0Ug'.repeat(4)}`,
      `${'0123456789abcdef'.repeat(2)}${'01234567'}`, // Deepgram: forty hex digits
      `${'ATATT'}3xFfGF0${'Tq9_Zk-1'.repeat(20)}=A1B2C3D4`, // Atlassian (Jira)
      `${'lin'}_${'api'}_${'Ab12Cd34'.repeat(5)}`,
      `${'apify'}_${'api'}_${'Xy98Wv76'.repeat(4)}`,
      `${'ya29'}.${'a0AfH6SM'.repeat(6)}`, // Google access token
      `${'1'}//${'0gAbCdEfGh'.repeat(5)}`, // Google refresh token
      `${'GOCSPX'}-${'aB3dE5fG7hJ9kL1mN2pQ4rS6tU8'}`, // Google OAuth client secret
    ];
    for (const key of keys) {
      // Exactly the key, whole: nothing of it left, nothing around it taken.
      expect(scrub(`upstream said 401 for ${key} just now`)).toBe('upstream said 401 for [credential] just now');
    }
  });

  it('removes a Deepgram key after Token, keeping the word', () => {
    const key = `${'0123456789abcdef'.repeat(2)}${'01234567'}`;
    expect(scrub(`Authorization: Token ${key}`)).toBe('Authorization: Token [credential]');
  });

  it('removes a bearer token however Bearer is written, + / = and all', () => {
    const token = `${'AbC+dEf/gHi'}${'9'.repeat(8)}==`;
    for (const word of ['Bearer', 'bearer', 'BEARER']) {
      expect(scrub(`Authorization: ${word} ${token} was refused`)).toBe(`Authorization: ${word} [credential] was refused`);
    }
  });

  it('removes HTTP Basic credentials, keeping the word Basic', () => {
    const encoded = Buffer.from(`${'priya'}:${'hunter2-but-longer'}`).toString('base64');
    expect(scrub(`Authorization: Basic ${encoded}`)).toBe('Authorization: Basic [credential]');
    expect(scrub(`basic ${encoded} rejected`)).toBe('basic [credential] rejected');
  });

  it('removes an authorization header’s value whatever its scheme, as text, JSON or a dumped object', () => {
    const key = `k${'9f8e7d6c5b4a'.repeat(2)}`;
    expect(scrub(`authorization: ${key} rejected`)).toBe('authorization: [credential] rejected');
    expect(scrub(`{"Authorization":"Token ${key}"}`)).toBe('{"Authorization":"Token [credential]"}');
    expect(scrub(`headers: { authorization: '${key}' }`)).toBe("headers: { authorization: '[credential]' }");
  });

  it('removes the user and password from a URL, and keeps where it was going', () => {
    // An @ inside the password too, which the address rule alone would split.
    const password = `${'p@ss'}${'w0rd!'}`;
    expect(scrub(`connect to postgres://postgres.abcd:${password}@db.example.supabase.co:5432/postgres failed`)).toBe(
      'connect to postgres://[credential]@db.example.supabase.co:5432/postgres failed',
    );
    expect(scrub(`GET https://user:${password}@127.0.0.1:8080/x`)).toBe('GET https://[credential]@127.0.0.1:8080/x');
  });

  it('redacts a customer identifier the model quoted back', () => {
    // An upstream 400 echoes the request, and the request is meeting content.
    const said = scrub('invalid_request: input contained priya.shah@northwind.co.uk');

    expect(said).not.toContain('northwind.co.uk');
    expect(said).toContain('[email]');
  });

  it('caps a message that would otherwise be a transcript', () => {
    expect(scrub('x'.repeat(9000)).length).toBeLessThanOrEqual(2000);
  });

  it('leaves an ordinary message alone, because it is what gets read', () => {
    const said = 'temperature is deprecated for this model';

    expect(scrub(said)).toBe(said);
  });
});

describe('recording, kept alive past the response', () => {
  it('hands its write to waitUntil, so the alarm does not lose a row to a frozen function', async () => {
    const rpc = vi.fn(async () => ({ data: 'failure-1', error: null }));
    const kept: Promise<unknown>[] = [];
    recordFailure(new Error('boom'), {
      db: { rpc } as unknown as SupabaseClient,
      source: 'api/test',
      waitUntil: (work) => kept.push(work),
    });

    expect(kept).toHaveLength(1);
    await kept[0];
    expect(rpc).toHaveBeenCalledWith('record_failure', expect.objectContaining({ p_source: 'api/test' }));
  });

  it('never throws, even when waitUntil does', () => {
    const rpc = vi.fn(async () => ({ data: 'failure-1', error: null }));
    expect(() =>
      recordFailure(new Error('boom'), {
        db: { rpc } as unknown as SupabaseClient,
        source: 'api/test',
        waitUntil: () => {
          throw new Error('outside a request');
        },
      }),
    ).not.toThrow();
  });
});
