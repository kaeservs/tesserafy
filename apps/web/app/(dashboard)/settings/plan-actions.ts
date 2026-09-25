'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type PlanActionState =
  | { status: 'idle' }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

const OUTCOME: Record<string, string> = {
  started: 'Your plan has started.',
  upgraded: 'Upgraded. The larger allowance applies now.',
  downgrade_scheduled: 'The change will happen at the end of this period. Until then you keep what you have.',
  kept: 'Done — nothing will change at the end of this period.',
};

/**
 * Start, upgrade, downgrade, or undo a pending change — whichever the choice
 * means from where the company is. `change_plan` decides which; the owner
 * only says which plan they want.
 *
 * Free until payments exist (the owner's decision): starting or upgrading
 * takes effect without checkout. When Stripe lands, those two become a
 * redirect to checkout, and the database's rules do not change.
 */
async function changePlan(formData: FormData): Promise<PlanActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('change_plan', { p_plan: text(formData, 'plan') });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can change the plan.'
          : error.message.replace(/^change_plan: /, ''),
    };
  }
  revalidatePath('/settings');
  return { status: 'done', message: OUTCOME[data] ?? 'Done.' };
}

async function cancelPlan(): Promise<PlanActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_plan');
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501' ? 'Only an owner can cancel.' : error.message.replace(/^cancel_plan: /, ''),
    };
  }
  revalidatePath('/settings');
  return {
    status: 'done',
    message: 'Cancelled. The plan runs to the end of this period; your calls stay after that.',
  };
}

/**
 * Every plan button goes through here, so the message the page shows is
 * always the answer to the last thing the owner did. With one action per
 * kind of change, a cancel's page kept showing an earlier "nothing will
 * change" — the opposite of what had just happened.
 */
export async function planAction(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  return text(formData, 'intent') === 'cancel' ? cancelPlan() : changePlan(formData);
}
