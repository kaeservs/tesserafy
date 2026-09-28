'use server';

import { redirect } from 'next/navigation';
import { requireOperatorMember } from '@/lib/admin';

export type MfaState =
  | { status: 'idle' }
  | { status: 'enrolling'; factorId: string; qr: string; secret: string }
  | { status: 'error'; message: string; factorId?: string; qr?: string; secret?: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Start setting up an authenticator: a TOTP secret, shown as a QR code for
 * the app to scan. An unfinished earlier attempt is removed first, so an
 * operator who gave up halfway does not collect half-made factors.
 */
export async function startEnrolment(_prev: MfaState): Promise<MfaState> {
  const { db } = await requireOperatorMember();
  const { data: factors } = await db.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === 'unverified') await db.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Tesserafy console' });
  if (error || !data) return { status: 'error', message: error?.message ?? 'Could not start. Try again.' };
  return { status: 'enrolling', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Check a six-digit code against a factor — the new one while setting up, or
 * the operator's existing one at sign-in. Passing it makes this session aal2,
 * which is what the database asks for.
 */
export async function verifyCode(prev: MfaState, formData: FormData): Promise<MfaState> {
  const { db } = await requireOperatorMember();
  const code = text(formData, 'code').replace(/\s+/g, '');
  const factorId = text(formData, 'factorId');
  const again = (message: string): MfaState => ({
    status: 'error',
    message,
    ...(factorId ? { factorId } : {}),
    ...(prev.status !== 'idle' && prev.qr ? { qr: prev.qr } : {}),
    ...(prev.status !== 'idle' && prev.secret ? { secret: prev.secret } : {}),
  });
  if (!/^\d{6}$/.test(code)) return again('The code is the six digits your authenticator shows.');
  if (!factorId) return again('Start again: there is no authenticator to check against.');

  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return again('That code did not work. Codes change every 30 seconds; try the current one.');
  redirect('/security');
}
