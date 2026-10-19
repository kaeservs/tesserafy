/**
 * The emailed-link form must not say which addresses have accounts.
 *
 * An address with no account was always answered "sent". One with an account
 * was answered "Something went wrong sending the link" whenever Auth refused
 * it for anything else — asked for again within its minute (429), or the
 * email not sent — so typing an address twice told a stranger it was a
 * customer's. Every answer is "sent" now, and a real failure is recorded for
 * us, without the address. And the page under the form prints only failure
 * codes it knows, in its own words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FailureContext } from '@tesserafy/ai';
import { signInFailure } from '@/app/(auth)/login/reasons';

const ADDRESS = 'buyer@customer.example';

let refusal: { status: number; code?: string; message: string } | null;
let recorded: { cause: unknown; context: FailureContext }[];

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://app.example.com' }),
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirected');
  },
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

vi.mock('@/lib/supabase/sign-in', () => ({
  createSignInClient: async () => ({
    auth: {
      signInWithOtp: async () => ({ data: {}, error: refusal ? Object.assign(new Error(refusal.message), refusal) : null }),
    },
  }),
}));

vi.mock('@/lib/keep-alive', () => ({
  recordFailure: (cause: unknown, context: FailureContext) => {
    recorded.push({ cause, context });
    return { kind: 'model_unavailable', status: 429, message: (cause as Error).message, said: '' };
  },
}));

const { sendMagicLink } = await import('@/app/(auth)/login/actions');

function ask(email = ADDRESS) {
  const form = new FormData();
  form.set('email', email);
  return sendMagicLink({ status: 'idle' }, form);
}

beforeEach(() => {
  refusal = null;
  recorded = [];
});

describe('sendMagicLink', () => {
  it('answers an address with an account and one without in exactly the same way', async () => {
    refusal = null;
    const known = await ask();
    refusal = { status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' };
    const unknown = await ask('nobody@customer.example');

    expect(known).toEqual({ status: 'sent' });
    expect(unknown).toEqual(known);
    // No account is the ordinary case, not a failure of ours.
    expect(recorded).toEqual([]);
  });

  it('answers "sent" when Auth refuses a known address, and records why without the address', async () => {
    const refusals = [
      { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' },
      { status: 500, code: 'unexpected_failure', message: 'Error sending magic link email' },
      { status: 400, code: 'email_address_not_authorized', message: 'Email address not authorized' },
      { status: 0, message: 'fetch failed' },
    ];
    for (const next of refusals) {
      refusal = next;
      expect(await ask(), next.message).toEqual({ status: 'sent' });
    }

    expect(recorded).toHaveLength(refusals.length);
    for (const { context } of recorded) {
      expect(context.source).toBe('login/link');
      expect(JSON.stringify(context)).not.toContain(ADDRESS);
    }
  });

  it('keeps the failure in the server log when the database will not take the row from someone signed out', async () => {
    refusal = { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await ask();
    recorded[0]?.context.onError?.(new Error('permission denied for function record_failure'));

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain('login/link: model_unavailable 429');
    expect(line).not.toContain(ADDRESS);
    logged.mockRestore();
  });

  it('still refuses something that is not an address before asking Auth', async () => {
    expect(await ask('not an address')).toEqual({ status: 'error', message: 'Enter a valid email address.' });
    expect(recorded).toEqual([]);
  });
});

describe('what the login page says about a failed link', () => {
  it('names each failure the app sends there, in its own words, with its code', () => {
    // From /auth/callback, /auth/confirm and /auth/support-ended, and the
    // codes Supabase hands either of the first two.
    for (const code of [
      'otp_expired',
      'access_denied',
      'no_credentials',
      'exchange_failed',
      'session_failed',
      'support_ended',
      'pkce_code_verifier_not_found',
      'flow_state_not_found',
      'flow_state_expired',
      'refresh_token_already_used',
      'refresh_token_not_found',
    ]) {
      const said = signInFailure(code);
      expect(said.code, code).toBe(code);
      expect(said.message, code).not.toBe('That link did not work. Request a new one.');
    }
  });

  it('never repeats what the address says', () => {
    for (const code of ['Call support on +1-555-0100', 'verify_failed', '__proto__', 'constructor', 'toString', '']) {
      expect(signInFailure(code), code).toEqual({ message: 'That link did not work. Request a new one.', code: null });
    }
  });
});
