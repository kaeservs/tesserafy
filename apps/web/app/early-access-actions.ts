'use server';

import { recordFailure } from '@tesserafy/ai';
import { createClient } from '@/lib/supabase/server';

export type EarlyAccessState = { status: 'idle' } | { status: 'done' } | { status: 'error'; message: string };

const USE_CASES = new Set(['sales', 'onboarding', 'support', 'other']);

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}


/**
 * The landing page's early-access form, as the visitor (not signed in):
 * request_early_access takes the address and nothing else that could hurt.
 * A filled-in hidden field is a bot; it is told "done" and nothing is kept.
 * Asking twice is answered the same as once (the function says why).
 */
export async function requestEarlyAccess(_prev: EarlyAccessState, form: FormData): Promise<EarlyAccessState> {
  if (text(form, 'website').trim() !== '') return { status: 'done' };
  const email = text(form, 'email').trim();
  const company = text(form, 'company').trim();
  const useCase = text(form, 'use_case');
  const db = await createClient();
  const { error } = await db.rpc('request_early_access', {
    p_email: email,
    ...(company ? { p_company: company.slice(0, 120) } : {}),
    ...(USE_CASES.has(useCase) ? { p_use_case: useCase } : {}),
  });
  if (!error) return { status: 'done' };
  if (error.code === '22023') return { status: 'error', message: 'That does not look like an email address.' };
  if (error.code === '54000') return { status: 'error', message: 'A lot of people are asking right now. Please try again in an hour.' };
  recordFailure(error, { db, source: 'landing/early-access' });
  return { status: 'error', message: 'That did not work. Please try again in a moment.' };
}
