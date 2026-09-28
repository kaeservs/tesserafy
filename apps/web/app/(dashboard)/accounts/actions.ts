'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type AccountState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function message(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '42501') return fallback;
  if (error.code === '23514') return 'That domain does not look like one — something like acme.com.';
  return error.message.replace(/^(save|rename|delete)_account: /, '');
}

/** Add an account before there is a call with it — for a brief ahead of the first one. */
export async function addAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('save_account', {
    p_name: text(formData, 'name'),
    ...(text(formData, 'domain') ? { p_domain: text(formData, 'domain') } : {}),
  });
  if (error) return { status: 'error', message: message(error, 'Only a member of a company can add an account.') };
  revalidatePath('/accounts');
  redirect(`/accounts/${id}`);
}

/** Rename it or set its domain: `rename_account` allows an owner or whoever added it. */
export async function renameAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const id = text(formData, 'accountId');
  const supabase = await createClient();
  const { error } = await supabase.rpc('rename_account', {
    p_account_id: id,
    p_name: text(formData, 'name'),
    ...(text(formData, 'domain') ? { p_domain: text(formData, 'domain') } : {}),
  });
  if (error) return { status: 'error', message: message(error, 'Only an owner, or whoever added the account, can rename it.') };
  revalidatePath(`/accounts/${id}`);
  revalidatePath('/accounts');
  return { status: 'saved' };
}

/** Delete it, as an owner. Its calls stay, no longer linked to it. */
export async function deleteAccount(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_account', { p_account_id: text(formData, 'accountId') });
  if (error) return { status: 'error', message: message(error, 'Only an owner can delete an account.') };
  revalidatePath('/accounts');
  redirect('/accounts');
}
