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
  return {
    status: 'closed',
    callsErased: result.calls_erased,
    peopleRemoved: result.people_removed,
    exportedTickets: result.exported_tickets,
  };
}
