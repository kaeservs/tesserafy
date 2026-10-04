import { sealer, SealKeyMissing } from './sealed';

/**
 * A company's tracker token, sealed by this server before it is stored
 * (ADR 0015; how, in lib/sealed.ts). The company's id is bound in, so a token
 * copied into another company's row does not open there.
 */

const KEY_ENV = 'TRACKER_TOKEN_KEY';
const box = sealer(KEY_ENV);

/** Whether this deployment can connect trackers at all. */
export function trackerKeyAvailable(): boolean {
  return box.available();
}

export class TrackerKeyMissing extends SealKeyMissing {
  constructor() {
    super(KEY_ENV);
  }
}

export function sealToken(token: string, companyId: string): string {
  if (!box.available()) throw new TrackerKeyMissing();
  return box.seal(token, companyId);
}

/** The token, or null if the ciphertext was altered, is for another company, or needs another key. */
export function openToken(sealed: string, companyId: string): string | null {
  if (!box.available()) throw new TrackerKeyMissing();
  return box.open(sealed, companyId);
}

/** The last four characters: enough to tell tokens apart, useless on their own. */
export function tokenHint(token: string): string {
  return token.slice(-4);
}
