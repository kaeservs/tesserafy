import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * A secret sealed by this server before it is stored: a company's tracker
 * token, a person's calendar refresh token. The database only ever holds it
 * encrypted, with a key that lives in this server's environment and nowhere
 * else (ADR 0015). Somebody who could read the table — a member, a leaked
 * backup, an operator — gets bytes, not a token.
 *
 * AES-256-GCM, which also authenticates: a ciphertext that was altered, or
 * sealed with a different key, fails to open rather than opening wrong. The
 * owner's id (the company's, the person's) is bound in as associated data, so
 * a ciphertext copied into another row does not open there either.
 *
 * Format: `v1:<iv>:<tag>:<data>`, base64 each. The version is there so the
 * key or the algorithm can change without guessing what an old row is.
 *
 * Each kind of secret has its own key, so one leaking opens nothing else.
 */

export class SealKeyMissing extends Error {
  constructor(env: string) {
    super(`${env} is not set to 32 bytes of base64 in this deployment`);
  }
}

export interface Sealer {
  /** Whether this deployment has the key at all. */
  available(): boolean;
  seal(secret: string, owner: string): string;
  /** The secret, or null if the ciphertext was altered, is someone else's, or needs another key. */
  open(sealed: string, owner: string): string | null;
}

export function sealer(keyEnv: string): Sealer {
  const key = (): Buffer | null => {
    const raw = process.env[keyEnv];
    if (!raw) return null;
    const bytes = Buffer.from(raw, 'base64');
    return bytes.length === 32 ? bytes : null;
  };
  return {
    available: () => key() !== null,
    seal(secret, owner) {
      const k = key();
      if (!k) throw new SealKeyMissing(keyEnv);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', k, iv);
      cipher.setAAD(Buffer.from(owner, 'utf8'));
      const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64'))).join(':');
    },
    open(sealed, owner) {
      const k = key();
      if (!k) throw new SealKeyMissing(keyEnv);
      const [version, iv, tag, data] = sealed.split(':');
      if (version !== 'v1' || !iv || !tag || !data) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
        decipher.setAAD(Buffer.from(owner, 'utf8'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
