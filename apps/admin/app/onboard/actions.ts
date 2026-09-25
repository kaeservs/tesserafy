'use server';

import { revalidatePath } from 'next/cache';
import { createAccountFor, requireAdmin, type Admin } from '@/lib/admin';

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
      /** Set when the person was added but their request could not be closed. */
      requestStillOpen?: string;
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
/** Who to add, and where: an existing company, or a new one they will own. */
type Target =
  | { email: string; role: string; companyId: string }
  | { email: string; companyName: string; plan: string };

/**
 * The three steps, shared by the Add people form and by answering an owner's
 * request, so both go through exactly the same recorded path.
 */
async function provision(admin: Admin, target: Target): Promise<ProvisionState> {
  const email = target.email.trim().toLowerCase();
  const isNew = 'companyName' in target;

  const { data: record, error: opening } = await admin.db.rpc('open_account_provisioning', {
    p_email: email,
    p_role: isNew ? 'owner' : target.role,
    ...(isNew
      ? { p_company_name: target.companyName, p_plan: target.plan }
      : { p_company_id: target.companyId }),
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
  const target = text(formData, 'target');
  const email = text(formData, 'email');
  return provision(
    admin,
    target === 'new'
      ? { email, companyName: text(formData, 'companyName'), plan: text(formData, 'plan') }
      : { email, role: text(formData, 'role'), companyId: target },
  );
}

/**
 * Answer an owner's request by adding the person, then close it.
 *
 * Closed only after the person is really in: resolve_access_request checks
 * the membership exists rather than taking this call's word for it. If
 * closing fails the person is still added and the link still shown — the
 * request simply stays open, which is visible and harmless.
 */
export async function addFromRequest(
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const admin = await requireAdmin();
  const result = await provision(admin, {
    email: text(formData, 'email'),
    role: text(formData, 'role'),
    companyId: text(formData, 'companyId'),
  });
  if (result.status !== 'ready') return result;

  const { error } = await admin.db.rpc('resolve_access_request', {
    p_id: text(formData, 'requestId'),
    p_resolution: 'added',
  });
  revalidatePath('/onboard');
  return error ? { ...result, requestStillOpen: error.message } : result;
}

export type DeclineState = { status: 'idle' } | { status: 'error'; message: string };

/** Decline an owner's request, with the reason they will read. */
export async function declineRequest(_prev: DeclineState, formData: FormData): Promise<DeclineState> {
  const admin = await requireAdmin();
  const { error } = await admin.db.rpc('resolve_access_request', {
    p_id: text(formData, 'requestId'),
    p_resolution: 'declined',
    p_note: text(formData, 'reason'),
  });
  if (error) return { status: 'error', message: error.message.replace(/^resolve_access_request: /, '') };
  revalidatePath('/onboard');
  return { status: 'idle' };
}
