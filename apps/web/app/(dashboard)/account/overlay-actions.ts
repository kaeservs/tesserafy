'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { recordFailure } from '@/lib/keep-alive';
import { readLook } from '@/lib/overlay-look';
import { createClient } from '@/lib/supabase/server';

const reason = (message: string) => message.replace(/^[a-z_]+: /, '');

/**
 * A save that did not go through: recorded for us, and said on the page in
 * its own words. The page used to print whatever the address carried, and
 * the address is anyone's to write (security review, 2026-10-19).
 */
function failed(error: unknown, db: Awaited<ReturnType<typeof createClient>>, source: string): never {
  recordFailure(error, { db, source });
  redirect('/account/overlay?overlay=failed');
}

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
  if (error) failed(error, supabase, 'account/overlay/look');
  revalidatePath('/account/overlay');
  redirect('/account/overlay?overlay=saved');
}

/** Whether my overlay shows itself when a call starts. */
export async function saveDetectCalls(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_detect_calls', { p_on: formData.get('on') === 'on' });
  if (error) failed(error, supabase, 'account/overlay/detect');
  revalidatePath('/account/overlay');
  redirect('/account/overlay?overlay=saved');
}

/** Which prep is my next call in the overlay; empty clears it. */
export async function chooseNextCall(formData: FormData): Promise<void> {
  const prepId = formData.get('prepId');
  const back = formData.get('back');
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_next_call', typeof prepId === 'string' && prepId ? { p_prep_id: prepId } : {});
  if (error) throw new Error(reason(error.message));
  revalidatePath('/account/overlay');
  revalidatePath('/prep');
  if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) {
    revalidatePath(back);
    redirect(back);
  }
}
