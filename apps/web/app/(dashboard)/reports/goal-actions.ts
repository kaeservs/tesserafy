'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type GoalState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Set a criterion's goal as a percentage of calls, or clear it with an empty
 * box. Owners only — set_criterion_goal refuses anyone else.
 */
export async function setGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const raw = text(formData, 'target').replace(/%$/, '').trim();
  let target: number | null = null;
  if (raw !== '') {
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      return { status: 'error', message: 'A goal is a percentage of calls, 1 to 100.' };
    }
    target = Math.round(percent) / 100;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_criterion_goal', {
    p_engagement_type: text(formData, 'engagementType'),
    p_criterion_key: text(formData, 'criterionKey'),
    // Null clears the goal; the function takes it and has no default to omit to.
    p_target: target as number,
  });
  if (error) return { status: 'error', message: error.message.replace(/^[a-z_]+: /, '') };
  revalidatePath('/reports');
  revalidatePath('/reports/sellers/[id]', 'page');
  return { status: 'saved' };
}
