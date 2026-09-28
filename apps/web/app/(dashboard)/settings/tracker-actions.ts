'use server';

import { revalidatePath } from 'next/cache';
import { checkRepository, normaliseRepository } from '@/lib/github-tracker';
import { createClient } from '@/lib/supabase/server';
import { sealToken, tokenHint, trackerKeyAvailable } from '@/lib/tracker-secret';

export type TrackerState =
  | { status: 'idle' }
  | { status: 'connected'; target: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Connect the company's GitHub repository, as its owner.
 *
 * The token is checked against GitHub first, so a wrong repository or a token
 * for another account is found now rather than on the first ticket. Then it is
 * sealed here, on the server, bound to the company, and only the sealed form
 * goes to the database (ADR 0015). `connect_tracker` decides whether the caller
 * may: only an owner, only for their own company.
 */
export async function connectTracker(_prev: TrackerState, formData: FormData): Promise<TrackerState> {
  if (!trackerKeyAvailable()) {
    return { status: 'error', message: 'Tracker connections are not switched on for this deployment yet.' };
  }
  const target = normaliseRepository(text(formData, 'repository'));
  if (!target) return { status: 'error', message: 'Give the repository as owner/name, or paste its address.' };
  const token = text(formData, 'token').trim();
  if (token.length < 20) return { status: 'error', message: 'Paste the whole token.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();
  // Checked again by the database; asked here only so a member is not sent
  // round GitHub before being refused.
  if (membership?.role !== 'owner') return { status: 'error', message: 'Only an owner can connect a tracker.' };

  const check = await checkRepository(target, token);
  if (!check.ok) return { status: 'error', message: check.message };

  const { error } = await supabase.rpc('connect_tracker', {
    p_provider: 'github',
    p_target: check.fullName,
    p_token_ciphertext: sealToken(token, membership.company_id),
    p_token_hint: tokenHint(token),
  });
  if (error) {
    return {
      status: 'error',
      message: error.code === '42501' ? 'Only an owner can connect a tracker.' : error.message.replace(/^connect_tracker: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'connected', target: check.fullName };
}

export async function disconnectTracker(_prev: TrackerState): Promise<TrackerState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('disconnect_tracker');
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501' ? 'Only an owner can disconnect a tracker.' : error.message.replace(/^disconnect_tracker: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'idle' };
}
