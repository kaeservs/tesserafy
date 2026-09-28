import type { SupabaseClient } from '@tesserafy/db';

/**
 * Link a call to the customer it was with, by name: `save_account` finds the
 * account (or makes it), and `edit_conversation` sets it, logged like any
 * correction and allowed to the same people. Used where a call is created —
 * an import, a live call — so the rules are the database's, not each route's.
 *
 * Never throws: a call that could not be linked is still a call, and saying
 * who it was with can be done afterwards under Edit this call.
 */
export async function linkAccount(
  db: SupabaseClient,
  conversationId: string,
  account: { name?: string | null; id?: string | null },
): Promise<boolean> {
  let accountId = account.id ?? null;
  const name = account.name?.trim();
  if (!accountId && name) {
    const { data, error } = await db.rpc('save_account', { p_name: name });
    if (error || !data) return false;
    accountId = data;
  }
  if (!accountId) return false;
  const { error } = await db.rpc('edit_conversation', { p_conversation_id: conversationId, p_account_id: accountId });
  return !error;
}
