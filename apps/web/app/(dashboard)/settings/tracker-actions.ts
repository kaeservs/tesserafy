'use server';

import { revalidatePath } from 'next/cache';
import { checkRepository, normaliseRepository } from '@/lib/github-tracker';
import { checkJiraProject, normaliseJira } from '@/lib/jira-tracker';
import { checkLinearTeam, normaliseLinearTeam } from '@/lib/linear-tracker';
import { createClient } from '@/lib/supabase/server';
import { sealToken, tokenHint, trackerKeyAvailable } from '@/lib/tracker-secret';
import { isProvider, PROVIDER_NAME, type Provider } from '@/lib/trackers';

export type TrackerState =
  | { status: 'idle' }
  | { status: 'connected'; target: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

type Checked = { ok: true; target: string; secret: string; hint: string } | { ok: false; message: string };

/**
 * What the form says, checked with the tracker itself before anything is
 * stored — a wrong project or a token for another account is found now, not
 * on the first approved insight.
 */
async function checkWithTracker(provider: Provider, formData: FormData): Promise<Checked> {
  const token = text(formData, 'token').trim();
  if (provider === 'github') {
    const target = normaliseRepository(text(formData, 'repository'));
    if (!target) return { ok: false, message: 'Give the repository as owner/name, or paste its address.' };
    if (token.length < 20) return { ok: false, message: 'Paste the whole token.' };
    const check = await checkRepository(target, token);
    return check.ok ? { ok: true, target: check.fullName, secret: token, hint: tokenHint(token) } : check;
  }
  if (provider === 'jira') {
    const target = normaliseJira(text(formData, 'site'), text(formData, 'project'));
    if (!target) {
      return { ok: false, message: 'Give your Jira Cloud site (something.atlassian.net) and the project key, like PROD.' };
    }
    const email = text(formData, 'email').trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, message: 'Give the email of the Atlassian account the API token belongs to.' };
    if (token.length < 16) return { ok: false, message: 'Paste the whole API token.' };
    const check = await checkJiraProject(target, { email, token });
    return check.ok ? { ok: true, target, secret: JSON.stringify({ email, token }), hint: tokenHint(token) } : check;
  }
  const target = normaliseLinearTeam(text(formData, 'team'));
  if (!target) return { ok: false, message: 'Give the team key — the prefix of its issue ids, like ENG in ENG-12.' };
  if (token.length < 20) return { ok: false, message: 'Paste the whole API key.' };
  const check = await checkLinearTeam(target, token);
  return check.ok ? { ok: true, target, secret: token, hint: tokenHint(token) } : check;
}

/**
 * Connect the company's tracker — GitHub, Jira Cloud or Linear — as its owner.
 *
 * Checked with the tracker first, then sealed here, on the server, bound to the
 * company, and only the sealed form goes to the database (ADR 0015).
 * `connect_tracker` decides whether the caller may: only an owner, only for
 * their own company, only a target of the provider's own shape.
 */
export async function connectTracker(_prev: TrackerState, formData: FormData): Promise<TrackerState> {
  if (!trackerKeyAvailable()) {
    return { status: 'error', message: 'Tracker connections are not switched on for this deployment yet.' };
  }
  const provider = text(formData, 'provider') || 'github';
  if (!isProvider(provider)) return { status: 'error', message: 'Choose GitHub, Jira or Linear.' };

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
  // round the tracker before being refused.
  if (membership?.role !== 'owner') return { status: 'error', message: 'Only an owner can connect a tracker.' };

  const checked = await checkWithTracker(provider, formData);
  if (!checked.ok) return { status: 'error', message: checked.message };

  const { error } = await supabase.rpc('connect_tracker', {
    p_provider: provider,
    p_target: checked.target,
    p_token_ciphertext: sealToken(checked.secret, membership.company_id),
    p_token_hint: checked.hint,
  });
  if (error) {
    return {
      status: 'error',
      message: error.code === '42501' ? 'Only an owner can connect a tracker.' : error.message.replace(/^connect_tracker: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'connected', target: `${PROVIDER_NAME[provider]} ${checked.target}` };
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
