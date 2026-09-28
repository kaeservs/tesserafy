'use server';

import { recordFailure } from '@tesserafy/ai';
import { fetchCriteriaSets } from '@tesserafy/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { myCompanyId } from '@/lib/company';
import { describeRefusal, refund, spend, type Spent } from '@/lib/plan';
import { allowance } from '@/lib/rate-limit';
import { scoreUploadedConversation } from '@/lib/score-upload';
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

export type MoveState =
  | { status: 'idle' }
  | { status: 'moved'; moved: number; remaining: number; message: string }
  | { status: 'error'; message: string };

/** Calls moved per press: each re-scores in ~20 s, three at a time, inside one function's budget. */
const MOVE_BATCH = 10;
const MOVE_CONCURRENCY = 3;

/**
 * Move a scorecard's older calls onto its newest version, as the company's
 * owner, ten at a time.
 *
 * Publishing a version never re-scores history (ADR 0016); this is the
 * deliberate act that does, per call exactly as "Edit this call" does: the old
 * evidence goes, the call is scored again from its transcript after the
 * response, and each is charged as one imported call — refunded if it turns
 * out too long or empty. Stops where the plan runs out rather than failing
 * the whole batch.
 */
export async function moveCallsToNewest(_prev: MoveState, formData: FormData): Promise<MoveState> {
  const name = formData.get('name');
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(name)) {
    return { status: 'error', message: 'That is not a scorecard.' };
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    return { status: 'error', message: 'Scoring is not configured on this deployment.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from('company_members')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .limit(1)
    .maybeSingle();
  if (membership?.role !== 'owner') return { status: 'error', message: 'Only an owner can move calls.' };

  const companyId = await myCompanyId(supabase, user?.id);
  const newest = Math.max(
    0,
    ...(await fetchCriteriaSets(supabase, companyId))
      .filter((set) => set.engagementType === name)
      .map((set) => set.version),
  );
  if (newest === 0) return { status: 'error', message: 'That scorecard could not be found.' };

  const { data: older, count } = await supabase
    .from('conversations')
    .select('id', { count: 'exact' })
    .eq('engagement_type', name)
    .lt('criteria_version', newest)
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(MOVE_BATCH);
  const ids = (older ?? []).map((row) => row.id);
  if (ids.length === 0) return { status: 'moved', moved: 0, remaining: 0, message: 'Every call is already on the newest version.' };

  const limit = await allowance(supabase, 'scorecards/move');
  if (!limit.allowed) {
    return { status: 'error', message: `Calls were moved a moment ago. Try again in ${limit.retryAfterSeconds}s.` };
  }

  const moved: { id: string; spent: Spent }[] = [];
  let stopped: string | null = null;
  for (const id of ids) {
    const spent = await spend(supabase, 'calls');
    if (!spent.allowed) {
      stopped = describeRefusal(spent);
      break;
    }
    const { error } = await supabase.rpc('edit_conversation', {
      p_conversation_id: id,
      p_engagement_type: name,
      p_criteria_version: newest,
    });
    if (error) {
      await refund(supabase, spent);
      stopped = error.message.replace(/^edit_conversation: /, '');
      break;
    }
    moved.push({ id, spent });
  }

  after(async () => {
    let next = 0;
    const worker = async () => {
      while (next < moved.length) {
        const { id, spent } = moved[next++]!;
        try {
          const outcome = await scoreUploadedConversation(supabase, id);
          if (outcome.status !== 'scored') await refund(supabase, spent);
        } catch (cause) {
          recordFailure(cause, { db: supabase, source: 'scorecards/move', tier: 't1', conversationId: id });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MOVE_CONCURRENCY, moved.length) }, worker));
  });

  revalidatePath(`/scorecards/${name}`);
  revalidatePath('/conversations');
  const remaining = Math.max(0, (count ?? ids.length) - moved.length);
  const done = `${moved.length} call${moved.length === 1 ? ' is' : 's are'} being scored against version ${newest}; reload in a minute or two.`;
  return {
    status: 'moved',
    moved: moved.length,
    remaining,
    message: stopped ? `${done} Stopped there: ${stopped}` : remaining > 0 ? `${done} ${remaining} still to move.` : done,
  };
}
