/**
 * Only a session started by a sign-in link can be a support session (the
 * console mints a magic link), so only those are asked about; a password
 * session — the overlay's — never pays for the check.
 */
import { describe, expect, it } from 'vitest';
import { signedInByLink } from '../lib/support-session';

const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

describe('a session started by a sign-in link', () => {
  it('is asked about; a password session is not', () => {
    expect(signedInByLink(token({ amr: [{ method: 'otp', timestamp: 1 }] }))).toBe(true);
    expect(signedInByLink(token({ amr: [{ method: 'magiclink', timestamp: 1 }] }))).toBe(true);
    expect(signedInByLink(token({ amr: [{ method: 'password', timestamp: 1 }] }))).toBe(false);
    expect(signedInByLink(token({ amr: [{ method: 'password' }, { method: 'otp' }] }))).toBe(true);
  });

  it('is asked about when the token does not say, rather than let through', () => {
    expect(signedInByLink(token({}))).toBe(true);
    expect(signedInByLink('not a token')).toBe(true);
  });
});
