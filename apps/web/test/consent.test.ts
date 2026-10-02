import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { consentConfirmed, liveConsentStatement, RECORDING_AGREEMENT } from '../lib/consent';

describe('consentConfirmed', () => {
  it('accepts a ticked checkbox and an explicit true', () => {
    expect(consentConfirmed('on')).toBe(true);
    expect(consentConfirmed(true)).toBe(true);
  });

  it('refuses anything that is not an answer', () => {
    // A missing field, an unticked box and a truthy string that is not "on"
    // are all "nobody confirmed", which is what the route must hear.
    for (const value of [null, undefined, false, '', 'false', 'true', 1]) {
      expect(consentConfirmed(value)).toBe(false);
    }
  });
});

describe('the one-time recording agreement (ADR 0020)', () => {
  it('is shown by the overlay from the server, never from its own copy, and asked once rather than per call', () => {
    // The overlay is plain HTML; the words come from /api/live/setup, so what
    // the person agrees to is what the server keeps. No per-call box remains.
    const overlay = readFileSync(
      fileURLToPath(new URL('../../desktop/src/renderer/index.html', import.meta.url)),
      'utf-8',
    );
    expect(overlay).toContain('id="agreementText"');
    expect(overlay).not.toContain('id="consent"');
    expect(overlay).not.toContain(RECORDING_AGREEMENT.slice(0, 40));
  });

  it('makes every live call cite the agreement it rests on, by date and Terms version', () => {
    const statement = liveConsentStatement({ agreedAt: '2026-10-02T09:15:00Z', termsVersion: '2026-10-02' });
    expect(statement).toBe(`Recorded under the agreement made on 2026-10-02 (Terms 2026-10-02): ${RECORDING_AGREEMENT}`);
    // Long enough for the database's check, and says whose responsibility it is.
    expect(RECORDING_AGREEMENT.length).toBeGreaterThan(20);
    expect(RECORDING_AGREEMENT).toMatch(/my responsibility/);
  });
});
