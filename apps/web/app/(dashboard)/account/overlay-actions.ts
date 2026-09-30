'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readLook } from '@/lib/overlay-look';
import { createClient } from '@/lib/supabase/server';

const reason = (message: string) => message.replace(/^[a-z_]+: /, '');

/**
 * How the overlay looks, set here rather than on the overlay. The overlay
 * reads it when it signs in and before each call (/api/live/setup). The
 * database checks every value against the overlay's own lists.
 */
export async function saveOverlayLook(formData: FormData): Promise<void> {
  const look = readLook({
    theme: formData.get('theme'),
    accent: formData.get('accent'),
    opacity: Number(formData.get('opacity')),
    size: formData.get('size'),
  });
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_overlay_look', { p_look: { ...look } });
  if (error) redirect(`/account?overlay=${encodeURIComponent(reason(error.message))}#overlay-heading`);
  revalidatePath('/account');
  redirect('/account?overlay=saved#overlay-heading');
}

/** Which prep is my next call in the overlay; empty clears it. */
export async function chooseNextCall(formData: FormData): Promise<void> {
  const prepId = formData.get('prepId');
  const back = formData.get('back');
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_next_call', typeof prepId === 'string' && prepId ? { p_prep_id: prepId } : {});
  if (error) throw new Error(reason(error.message));
  revalidatePath('/account');
  revalidatePath('/prep');
  if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) {
    revalidatePath(back);
    redirect(back);
  }
}
