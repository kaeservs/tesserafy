/**
 * Only a session started by a sign-in link can be a support session (the
 * console mints a magic link), so only those are asked about; a password
 * session — the overlay's — never pays for the check.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it } from 'vitest';
import { inSupportSession, signedInByLink } from '../lib/support-session';

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

describe('whether a session is a support visit, before a change that would outlast it', () => {
  const answering = (data: unknown, error: unknown = null) => {
    const asked: string[] = [];
    const db = { rpc: (name: string) => (asked.push(name), Promise.resolve({ data, error })) } as unknown as SupabaseClient;
    return { db, asked };
  };
  const link = token({ amr: [{ method: 'otp', timestamp: 1 }] });

  it('asks the database about a session started by a link', async () => {
    const { db, asked } = answering(true);
    expect(await inSupportSession(db, link)).toBe(true);
    expect(asked).toEqual(['in_support_session']);
  });

  it('never asks about a password session, which no support visit is', async () => {
    const { db, asked } = answering(true);
    expect(await inSupportSession(db, token({ amr: [{ method: 'password', timestamp: 1 }] }))).toBe(false);
    expect(asked).toEqual([]);
  });

  it('refuses when the database cannot say', async () => {
    const { db } = answering(null, { message: 'down' });
    expect(await inSupportSession(db, link)).toBe(true);
  });
});
