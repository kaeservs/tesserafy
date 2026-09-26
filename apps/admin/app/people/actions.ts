'use server';

import { revalidatePath } from 'next/cache';
import { deleteAccountFor, requireAdmin } from '@/lib/admin';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export interface DeleteOutcome {
  email: string;
  /** deleted; refused before anything happened; or deleted in Auth but not recorded as finished. */
  result: 'deleted' | 'refused' | 'unfinished';
  message?: string;
}

export type DeleteState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; outcomes: DeleteOutcome[] };

/**
 * Delete accounts, as the operator: each one record, key, record (ADR 0013).
 *
 * One account at a time, and each on its own: a refusal for one (they joined
 * a company since the page loaded, a session was opened on them) says why
 * and does not stop the rest. The order inside each is the whole design —
 * `open_account_deletion` decides and writes down before the key deletes
 * anything, and a failure after that leaves the record open, shown as not
 * finished, which is what happened.
 *
 * The confirmation is checked here, not trusted to the form: the operator
 * types the address for one account, or the number for several.
 */
export async function deleteAccounts(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const admin = await requireAdmin();
  const ids = formData.getAll('id').filter((id): id is string => typeof id === 'string' && id.length > 0);
  const reason = text(formData, 'reason').trim();
  const confirm = text(formData, 'confirm').trim().toLowerCase();

  if (ids.length === 0) return { status: 'error', message: 'No account is ticked.' };
  if (!reason) return { status: 'error', message: 'Say why.' };

  const { data: people } = await admin.db.rpc('admin_users');
  const emailOf = new Map((people ?? []).map((person) => [person.user_id, person.email ?? '']));
  const expected = ids.length === 1 ? (emailOf.get(ids[0]!) ?? '').toLowerCase() : String(ids.length);
  if (!expected || confirm !== expected) {
    return {
      status: 'error',
      message:
        ids.length === 1
          ? 'Type the address of the account being deleted.'
          : `Type ${ids.length}, the number of accounts ticked.`,
    };
  }

  const outcomes: DeleteOutcome[] = [];
  for (const id of ids) {
    const email = emailOf.get(id) ?? id;

    const { data: opened, error: openError } = await admin.db.rpc('open_account_deletion', {
      p_user_id: id,
      p_reason: reason,
    });
    if (openError || !opened) {
      outcomes.push({
        email,
        result: 'refused',
        message: (openError?.message ?? 'not recorded').replace(/^open_account_deletion: /, ''),
      });
      continue;
    }

    const deleted = await deleteAccountFor(id);
    if (!deleted.ok) {
      outcomes.push({ email, result: 'unfinished', message: deleted.message });
      continue;
    }

    const { error: completeError } = await admin.db.rpc('complete_account_deletion', { p_id: opened.id });
    outcomes.push(
      completeError
        ? {
            email,
            result: 'unfinished',
            message: `Deleted, but the record was not closed: ${completeError.message.replace(/^complete_account_deletion: /, '')}`,
          }
        : { email, result: 'deleted' },
    );
  }

  revalidatePath('/people');
  revalidatePath('/');
  return { status: 'done', outcomes };
}
