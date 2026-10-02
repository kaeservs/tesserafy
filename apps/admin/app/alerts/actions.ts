'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin';

export type TokenState = { status: 'idle' } | { status: 'made'; token: string } | { status: 'error'; message: string };

/**
 * Make the alerting workflow's token (ADR 0019). The database keeps only its
 * hash and revokes the last one; the token itself is in this answer once,
 * for the operator to paste into n8n, and nowhere else.
 */
export async function makeToken(_prev: TokenState): Promise<TokenState> {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_create_ops_token');
  if (error || typeof data !== 'string') {
    return { status: 'error', message: (error?.message ?? 'no token came back').replace(/^admin_create_ops_token: /, '') };
  }
  revalidatePath('/alerts');
  return { status: 'made', token: data };
}

export async function revokeToken(_prev: TokenState): Promise<TokenState> {
  const admin = await requireAdmin();
  const { error } = await admin.db.rpc('admin_revoke_ops_token');
  if (error) return { status: 'error', message: error.message.replace(/^admin_revoke_ops_token: /, '') };
  revalidatePath('/alerts');
  return { status: 'idle' };
}
