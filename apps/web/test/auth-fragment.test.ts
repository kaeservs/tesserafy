import { describe, expect, it } from 'vitest';
import { parseAuthFragment } from '../lib/auth-fragment';

describe('parseAuthFragment', () => {
  it('reads a session', () => {
    const result = parseAuthFragment('#access_token=abc&refresh_token=def&token_type=bearer');

    expect(result).toEqual({
      kind: 'session',
      session: { accessToken: 'abc', refreshToken: 'def' },
    });
  });

  it('works with or without the leading hash', () => {
    expect(parseAuthFragment('access_token=abc&refresh_token=def').kind).toBe('session');
  });

  it('refuses an access token with no refresh token', () => {
    // A session that cannot refresh dies in an hour, which surfaces as a
    // mysterious logout later rather than a failure now.
    expect(parseAuthFragment('#access_token=abc').kind).toBe('empty');
  });

  it('reads an error, which arrives in the same fragment', () => {
    const result = parseAuthFragment(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );

    expect(result).toEqual({
      kind: 'error',
      error: { code: 'otp_expired', description: 'Email link is invalid' },
    });
  });

  it('prefers the specific error code over the general one', () => {
    const result = parseAuthFragment('#error=access_denied&error_code=otp_expired');

    expect(result.kind === 'error' && result.error.code).toBe('otp_expired');
  });

  it('falls back to the general error when there is no code', () => {
    const result = parseAuthFragment('#error=server_error');

    expect(result.kind === 'error' && result.error.code).toBe('server_error');
  });

  it('calls an empty fragment empty', () => {
    expect(parseAuthFragment('').kind).toBe('empty');
    expect(parseAuthFragment('#').kind).toBe('empty');
  });
});
