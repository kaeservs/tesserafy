'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export type CloseState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'closed';
      callsErased: number;
      peopleRemoved: number;
      exportedTickets: { provider: string; url: string }[];
    };

/**
 * Close a company, as the operator.
 *
 * No key: `close_company` runs as the signed-in operator, checks they are a
 * platform admin, the reason, and the name typed back, and does the whole
 * thing in one transaction. The console only relays what it says.
 */
export async function closeCompany(_prev: CloseState, formData: FormData): Promise<CloseState> {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('close_company', {
    p_company_id: text(formData, 'companyId'),
    p_reason: text(formData, 'reason'),
    p_confirm_name: text(formData, 'confirmName'),
  });
  if (error) return { status: 'error', message: error.message.replace(/^close_company: /, '') };

  const result = data as {
    calls_erased: number;
    people_removed: number;
    exported_tickets: { provider: string; url: string }[];
  };
  revalidatePath('/companies');
  revalidatePath('/onboard');
  revalidatePath('/');
  revalidatePath('/people');
  return {
    status: 'closed',
    callsErased: result.calls_erased,
    peopleRemoved: result.people_removed,
    exportedTickets: result.exported_tickets,
  };
}

export type SetPlanState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Set a company's plan, as the operator: effective now, recorded in the
 * company's plan history under the operator's name. `admin_set_plan` checks
 * the operator is one and the company is open.
 */
export async function setPlan(_prev: SetPlanState, formData: FormData): Promise<SetPlanState> {
  const admin = await requireAdmin();
  const { error } = await admin.db.rpc('admin_set_plan', {
    p_company_id: text(formData, 'companyId'),
    p_plan: text(formData, 'plan'),
  });
  if (error) return { status: 'error', message: error.message.replace(/^admin_set_plan: /, '') };
  revalidatePath('/companies');
  return { status: 'idle' };
}

export type SignupSwitchState = { status: 'idle' } | { status: 'error'; message: string };

/** Open or close self-serve sign-up. The database records who, and when. */
export async function setSignupOpen(_prev: SignupSwitchState, formData: FormData): Promise<SignupSwitchState> {
  const admin = await requireAdmin();
  const { error } = await admin.db.rpc('admin_set_signup_open', { p_open: text(formData, 'open') === 'true' });
  if (error) return { status: 'error', message: error.message.replace(/^admin_set_signup_open: /, '') };
  revalidatePath('/companies');
  return { status: 'idle' };
}
