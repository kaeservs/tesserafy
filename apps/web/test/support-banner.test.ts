import { describe, expect, it } from 'vitest';
import { supportBanner } from '../lib/support-banner';

const NOW = new Date('2026-09-24T12:00:00Z');

function row(minutesFromNow: number, reason = 'blank dashboard, ticket 12') {
  return { reason, expires_at: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString() };
}

describe('supportBanner', () => {
  it('says nothing when nobody has access', () => {
    expect(supportBanner([], NOW)).toBeNull();
  });

  it('says nothing about access that has already ended', () => {
    // An expired row is history, which the access log shows. A banner for it
    // would tell the customer someone is in their account when nobody is.
    expect(supportBanner([row(-5)], NOW)).toBeNull();
  });

  it('names the reason and how long is left', () => {
    const banner = supportBanner([row(30)], NOW);

    expect(banner?.headline).toContain('Tesserafy support has access');
    expect(banner?.detail).toContain('blank dashboard, ticket 12');
    expect(banner?.detail).toContain('30 min');
  });

  it('reports the session that keeps the account open longest', () => {
    const banner = supportBanner([row(10, 'first'), row(120, 'second')], NOW);

    expect(banner?.detail).toContain('second');
    expect(banner?.detail).toContain('2 h');
    expect(banner?.detail).toContain('2 support sessions are open');
  });

  it('never counts down to zero while access is still open', () => {
    // Twenty seconds left is still access, and "0 min" would read as over.
    const almost = { reason: 'x', expires_at: new Date(NOW.getTime() + 20_000).toISOString() };

    expect(supportBanner([almost], NOW)?.detail).toContain('1 min');
  });
});
