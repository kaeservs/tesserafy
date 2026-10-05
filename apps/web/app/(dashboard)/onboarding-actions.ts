'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * The first-run steps are done, or skipped for good: either way they are not
 * shown again, and the plan the person is on counts as one they have seen.
 */
export async function finishOnboarding(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('finish_onboarding');
  revalidatePath('/', 'layout');
}

/** The person has been shown what their company's change of plan means. */
export async function markPlanSeen(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('mark_plan_seen');
  revalidatePath('/', 'layout');
}
