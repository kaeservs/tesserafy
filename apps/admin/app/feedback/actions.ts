'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

/**
 * Mark feedback seen or done, as the signed-in operator. The function checks
 * they are one and records who; no service-role key is involved.
 */
export async function setFeedbackStatus(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = formData.get('id');
  const status = formData.get('status');
  if (typeof id !== 'string' || typeof status !== 'string') return;
  const { error } = await admin.db.rpc('admin_set_feedback_status', { p_feedback_id: id, p_status: status });
  if (error) throw new Error(error.message);
  revalidatePath('/feedback');
}
