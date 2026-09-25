'use server';

import { revalidatePath } from 'next/cache';
import { createAccountFor, requireAdmin } from '@/lib/admin';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export type ProvisionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      recordId: string;
      email: string;
      link: string;
      newAccount: boolean;
      landsElsewhere?: string;
    };

/**
 * Add a person: to a new company as its owner, or to an existing one.
 *
 * In the order that makes the record mean something, as openSession does:
 *   1. open_account_provisioning, as the operator — allowed? written down.
 *   2. createAccountFor, the key — an account and a link, nothing else.
 *   3. complete_account_provisioning, as the operator — the account is the
 *      one recorded; the company and the membership are made.
 * A failure after step 1 leaves the record open, which is what happened.
 */
export async function provisionAccount(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const admin = await requireAdmin();

  const email = text(formData, 'email').trim().toLowerCase();
  const target = text(formData, 'target');
  const isNew = target === 'new';

  const { data: record, error: opening } = await admin.db.rpc('open_account_provisioning', {
    p_email: email,
    p_role: isNew ? 'owner' : text(formData, 'role'),
    ...(isNew
      ? { p_company_name: text(formData, 'companyName'), p_plan: text(formData, 'plan') }
      : { p_company_id: target }),
  });
  if (opening) return { status: 'error', message: opening.message };

  const account = await createAccountFor(email);
  if (!account.ok) {
    return {
      status: 'error',
      message: `Recorded as ${record.id}, but no account was made. ${account.message}`,
    };
  }

  const { error: completing } = await admin.db.rpc('complete_account_provisioning', {
    p_id: record.id,
    p_user_id: account.userId,
    p_new_account: account.newAccount,
  });
  if (completing) {
    return {
      status: 'error',
      message: `Recorded as ${record.id} and the account exists, but it was not added: ${completing.message}`,
    };
  }

  revalidatePath('/onboard');
  revalidatePath('/companies');
  revalidatePath('/');
  return {
    status: 'ready',
    recordId: record.id,
    email,
    link: account.link,
    newAccount: account.newAccount,
    ...(account.landsElsewhere ? { landsElsewhere: account.landsElsewhere } : {}),
  };
}
