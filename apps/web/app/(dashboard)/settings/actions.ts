'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { RETENTION_CHOICES } from '@/lib/retention';

export type RetentionState =
  | { status: 'idle' }
  | { status: 'preview'; days: number; affected: number }
  | { status: 'saved'; days: number | null }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Only the offered periods; anything else is a hand-made request. */
function chosenDays(formData: FormData): number | null | undefined {
  const raw = text(formData, 'days');
  if (raw === 'keep') return null;
  const days = Number(raw);
  return RETENTION_CHOICES.includes(days) ? days : undefined;
}

function refused(code: string | undefined, message: string): RetentionState {
  return {
    status: 'error',
    message:
      code === '42501'
        ? 'Only an owner of this company can change how long calls are kept.'
        : `That did not work: ${message}`,
  };
}

/**
 * Setting a retention period, in two steps.
 *
 * A period is an instruction to delete, carried out every night without
 * anyone watching, so the owner sees the number it will delete before it is
 * saved. `retention_preview` counts exactly as the purge counts; the number
 * shown is the number that will happen, not an estimate. Going back to
 * keeping everything deletes nothing and needs no review.
 *
 * `set_retention` is what refuses a non-owner and an out-of-range period —
 * the checks here are only so the form can say so plainly.
 */
export async function changeRetention(
  _prev: RetentionState,
  formData: FormData,
): Promise<RetentionState> {
  const days = chosenDays(formData);
  if (days === undefined) {
    return { status: 'error', message: 'Choose one of the periods offered.' };
  }

  const supabase = await createClient();

  if (days !== null && text(formData, 'step') !== 'confirm') {
    const { data, error } = await supabase.rpc('retention_preview', { p_days: days });
    if (error) return refused(error.code, error.message);
    return { status: 'preview', days, affected: data };
  }

  if (days !== null) {
    // The count may have moved since the preview; confirming it again is
    // cheap, and "type delete" is only asked for when something will go.
    const { data: affected, error } = await supabase.rpc('retention_preview', { p_days: days });
    if (error) return refused(error.code, error.message);
    if (affected > 0 && text(formData, 'confirm').trim().toLowerCase() !== 'delete') {
      return { status: 'preview', days, affected };
    }
  }

  const { error } = await supabase.rpc('set_retention', {
    // null is "keep everything", and the argument has no default to omit it
    // to: the generated type cannot say a nullable argument, so the cast
    // stays.
    p_days: days as number,
  });
  if (error) return refused(error.code, error.message);

  revalidatePath('/settings');
  return { status: 'saved', days };
}
