'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Approving or dismissing an insight.
 *
 * Runs as the signed-in user against `decide_insight`, which checks membership
 * and stamps the approver from `auth.uid()`. The browser cannot say who
 * approved something, and this action cannot either — which is the point, since
 * "a person approved this" is the claim a created ticket rests on.
 */
export async function decideInsight(
  insightId: string,
  status: 'approved' | 'dismissed',
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc('decide_insight', {
    p_insight_id: insightId,
    p_status: status,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/insights/${insightId}`);
  revalidatePath('/insights');
  return {};
}
