'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

export type SwitchState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Require two-step sign-in, or stop. `admin_set_operator_mfa` decides: it
 * wants this session to have passed the second step, and refuses to turn it
 * on while any operator has no authenticator.
 */
export async function setRequired(_prev: SwitchState, formData: FormData): Promise<SwitchState> {
  const admin = await requireAdmin();
  const { error } = await admin.db.rpc('admin_set_operator_mfa', { p_required: formData.get('required') === 'true' });
  if (error) return { status: 'error', message: error.message.replace(/^admin_set_operator_mfa: /, '') };
  revalidatePath('/security');
  return { status: 'idle' };
}
