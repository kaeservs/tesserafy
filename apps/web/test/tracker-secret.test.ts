import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openToken, sealToken, tokenHint, TrackerKeyMissing, trackerKeyAvailable } from '../lib/tracker-secret';

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';

describe('tracker tokens, sealed', () => {
  const previous = process.env['TRACKER_TOKEN_KEY'];
  beforeEach(() => {
    process.env['TRACKER_TOKEN_KEY'] = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    if (previous === undefined) delete process.env['TRACKER_TOKEN_KEY'];
    else process.env['TRACKER_TOKEN_KEY'] = previous;
  });

  it('opens what it sealed, and the stored form does not contain the token', () => {
    const sealed = sealToken(TOKEN, ACME);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain('github_pat');
    expect(openToken(sealed, ACME)).toBe(TOKEN);
  });

  it('seals the same token differently each time', () => {
    expect(sealToken(TOKEN, ACME)).not.toBe(sealToken(TOKEN, ACME));
  });

  it('will not open for another company', () => {
    expect(openToken(sealToken(TOKEN, ACME), GLOBEX)).toBeNull();
  });

  it('will not open anything altered', () => {
    const [v, iv, tag, data] = sealToken(TOKEN, ACME).split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(openToken([v, iv, tag, flipped.toString('base64')].join(':'), ACME)).toBeNull();
    expect(openToken('not-a-sealed-token', ACME)).toBeNull();
  });

  it('will not open with another key', () => {
    const sealed = sealToken(TOKEN, ACME);
    process.env['TRACKER_TOKEN_KEY'] = randomBytes(32).toString('base64');
    expect(openToken(sealed, ACME)).toBeNull();
  });

  it('says plainly when the deployment has no key, rather than storing anything', () => {
    delete process.env['TRACKER_TOKEN_KEY'];
    expect(trackerKeyAvailable()).toBe(false);
    expect(() => sealToken(TOKEN, ACME)).toThrow(TrackerKeyMissing);
    process.env['TRACKER_TOKEN_KEY'] = Buffer.from('too short').toString('base64');
    expect(trackerKeyAvailable()).toBe(false);
  });

  it('hints with the last four characters only', () => {
    expect(tokenHint(TOKEN)).toBe('wxyz');
  });
});
