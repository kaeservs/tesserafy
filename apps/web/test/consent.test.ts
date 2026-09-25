import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSENT_STATEMENTS, consentConfirmed } from '../lib/consent';

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

describe('the overlay shows the words the server stores', () => {
  it('has the live statement verbatim', () => {
    // The overlay is plain HTML and cannot import this module, so it carries
    // its own copy. A reworded copy would mean a call records words the
    // person was never shown.
    const overlay = readFileSync(
      fileURLToPath(new URL('../../desktop/src/renderer/index.html', import.meta.url)),
      'utf-8',
    );
    expect(overlay.replace(/\s+/g, ' ')).toContain(CONSENT_STATEMENTS.live);
  });
});
