import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * A company's tracker token, sealed by this server before it is stored.
 *
 * The token can write to a customer's tracker, so the database only ever
 * holds it encrypted, with a key that lives in this server's environment and
 * nowhere else (ADR 0015). Somebody who could read the table — a member, a
 * leaked backup, an operator — gets bytes, not a token.
 *
 * AES-256-GCM, which also authenticates: a ciphertext that was altered, or
 * sealed with a different key, fails to open rather than opening wrong. The
 * company's id is bound in as associated data, so a ciphertext copied into
 * another company's row does not open there either.
 *
 * Format: `v1:<iv>:<tag>:<data>`, base64 each. The version is there so the
 * key or the algorithm can change without guessing what an old row is.
 */

const KEY_ENV = 'TRACKER_TOKEN_KEY';

function key(): Buffer | null {
  const raw = process.env[KEY_ENV];
  if (!raw) return null;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length === 32 ? bytes : null;
}

/** Whether this deployment can connect trackers at all. */
export function trackerKeyAvailable(): boolean {
  return key() !== null;
}

export class TrackerKeyMissing extends Error {
  constructor() {
    super(`${KEY_ENV} is not set to 32 bytes of base64 in this deployment`);
  }
}

export function sealToken(token: string, companyId: string): string {
  const k = key();
  if (!k) throw new TrackerKeyMissing();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  cipher.setAAD(Buffer.from(companyId, 'utf8'));
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64'))).join(':');
}

/** The token, or null if the ciphertext was altered, is for another company, or needs another key. */
export function openToken(sealed: string, companyId: string): string | null {
  const k = key();
  if (!k) throw new TrackerKeyMissing();
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(companyId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The last four characters: enough to tell tokens apart, useless on their own. */
export function tokenHint(token: string): string {
  return token.slice(-4);
}
