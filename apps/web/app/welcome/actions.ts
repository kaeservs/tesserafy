'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type CreateCompanyState = { status: 'idle' } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Name the company, and start its trial.
 *
 * `create_my_company` makes every decision: sign-up open, the address
 * confirmed, no company yet, and none created by this account before. The
 * trial begins by itself when the company exists.
 */
export async function createCompany(_prev: CreateCompanyState, formData: FormData): Promise<CreateCompanyState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_my_company', { p_name: text(formData, 'name') });
  if (error) return { status: 'error', message: error.message.replace(/^create_my_company: /, '') };
  // Outside any try: redirect() works by throwing.
  redirect('/dashboard');
}
