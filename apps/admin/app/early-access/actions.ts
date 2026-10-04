'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

/** Mark someone on the early-access list as invited, or undo it. */
export async function markInvited(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const raw = form.get('id');
  const id = typeof raw === 'string' ? raw : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await admin.db.rpc('admin_mark_early_access', { p_id: id, p_invited: form.get('invited') === 'yes' });
  revalidatePath('/early-access');
}

/** Take someone off the list: spam, or a person who asked to be removed. */
export async function removeEntry(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const raw = form.get('id');
  const id = typeof raw === 'string' ? raw : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await admin.db.rpc('admin_remove_early_access', { p_id: id });
  revalidatePath('/early-access');
}
