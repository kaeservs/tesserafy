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
import { describe, expect, it } from 'vitest';
import { classify, scrub } from '../src/telemetry/failures';

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
