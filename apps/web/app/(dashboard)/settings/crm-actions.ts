'use server';

import { revalidatePath } from 'next/cache';
import { crmKeyAvailable, sealCrmToken } from '@/lib/crm';
import { checkHubSpot } from '@/lib/hubspot';
import { createClient } from '@/lib/supabase/server';
import { tokenHint } from '@/lib/tracker-secret';

export type CrmState = { status: 'idle' } | { status: 'connected'; account: string } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Connect the company's HubSpot, as its owner (ADR 0024): the private app's
 * token is checked with HubSpot first, then sealed here, bound to the company,
 * and only the sealed form goes to the database. `connect_crm` decides whether
 * the caller may.
 */
export async function connectCrm(_prev: CrmState, formData: FormData): Promise<CrmState> {
  if (!crmKeyAvailable()) return { status: 'error', message: 'CRM sync is not switched on for this deployment yet.' };
  const token = text(formData, 'token').trim();
  if (token.length < 20) return { status: 'error', message: 'Paste the whole access token.' };

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
  // round HubSpot before being refused.
  if (membership?.role !== 'owner') return { status: 'error', message: 'Only an owner can connect a CRM.' };

  const checked = await checkHubSpot(token);
  if (!checked.ok) return { status: 'error', message: checked.message };

  const { error } = await supabase.rpc('connect_crm', {
    p_provider: 'hubspot',
    p_account_ref: checked.portalId,
    p_token_ciphertext: sealCrmToken(token, membership.company_id),
    p_token_hint: tokenHint(token),
  });
  if (error) {
    return {
      status: 'error',
      message: error.code === '42501' ? 'Only an owner can connect a CRM.' : error.message.replace(/^connect_crm: /, ''),
    };
  }
  revalidatePath('/settings', 'layout');
  return { status: 'connected', account: `HubSpot account ${checked.portalId}` };
}

export async function disconnectCrm(_prev: CrmState): Promise<CrmState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('disconnect_crm');
  if (error) {
    return {
      status: 'error',
      message: error.code === '42501' ? 'Only an owner can disconnect a CRM.' : error.message.replace(/^disconnect_crm: /, ''),
    };
  }
  revalidatePath('/settings', 'layout');
  return { status: 'idle' };
}
