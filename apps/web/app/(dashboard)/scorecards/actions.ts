'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseDraft } from '@/lib/scorecard-draft';
import { createClient } from '@/lib/supabase/server';

export type PublishState = { status: 'idle' } | { status: 'error'; message: string };

/**
 * Publish a scorecard, or a new version of one, as the company's owner.
 *
 * `publish_scorecard` decides everything that matters — only an owner, only
 * their own company, only a set the scoring engine can score — so this passes
 * the draft on and reports what it says. A published version is never edited;
 * publishing again makes the next one, and calls already scored keep theirs.
 */
export async function publishScorecard(_prev: PublishState, formData: FormData): Promise<PublishState> {
  const raw = formData.get('draft');
  let body: unknown;
  try {
    body = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const draft = parseDraft(body);
  if (!draft) return { status: 'error', message: 'That is not a scorecard.' };

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc('publish_scorecard', {
    p_engagement_type: draft.name,
    p_criteria: draft.criteria.map((criterion, index) => ({
      key: criterion.key,
      label: criterion.label,
      definition: criterion.definition,
      weight: criterion.weight,
      position: index + 1,
    })),
  });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner can publish a scorecard.'
          : error.message.replace(/^publish_scorecard: /, ''),
    };
  }

  revalidatePath('/scorecards');
  redirect(`/scorecards/${draft.name}?published=${version}`);
}
