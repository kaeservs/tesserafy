'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type NameState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

/** The person's own name: shown in the dashboard, and the name their follow-up emails go out under. */
export async function saveName(_prev: NameState, formData: FormData): Promise<NameState> {
  const raw = formData.get('name');
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length > 100 || /[\r\n<>"]/.test(name)) {
    return { status: 'error', message: 'A name of up to 100 characters, without quotes or angle brackets.' };
  }
  const db = await createClient();
  const { error } = await db.rpc('set_display_name', { p_name: name });
  if (error) return { status: 'error', message: 'Your name could not be saved just now.' };
  revalidatePath('/', 'layout');
  return { status: 'saved' };
}
