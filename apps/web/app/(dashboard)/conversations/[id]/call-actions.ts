'use server';

import { recordFailure } from '@tesserafy/ai';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { describeRefusal, refund, spend, type Spent } from '@/lib/plan';
import { allowance } from '@/lib/rate-limit';
import { scoreUploadedConversation } from '@/lib/score-upload';
import { createClient } from '@/lib/supabase/server';

export type EditState =
  | { status: 'idle' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Correct a call — title, date, scorecard, outcome — as its company's owner
 * or whoever added it. `edit_conversation` decides who may and logs every
 * change; this passes on only what differs from what is stored.
 *
 * A new scorecard is the one change with a cost. The old evidence is removed
 * (it was recorded against another set's criteria) and the call is scored
 * again, after the response, exactly as an upload is — so it is rate-limited
 * and charged as one imported call like an upload, and given back if the
 * change is refused.
 */
export async function editCall(_prev: EditState, formData: FormData): Promise<EditState> {
  const id = text(formData, 'conversationId');
  const supabase = await createClient();
  const { data: current } = await supabase
    .from('conversations')
    .select('title, occurred_at, engagement_type, criteria_version, outcome, account_id')
    .eq('id', id)
    .maybeSingle();
  if (!current) return { status: 'error', message: 'That call could not be found.' };

  const title = text(formData, 'title');
  const date = text(formData, 'date');
  const [type, version] = text(formData, 'scorecard').split('/');
  const outcome = text(formData, 'outcome') || 'unknown';
  const accountName = text(formData, 'account');
  let accountId: string | null = null;
  if (accountName) {
    const { data: found, error: accountError } = await supabase.rpc('save_account', { p_name: accountName });
    if (accountError) return { status: 'error', message: accountError.message.replace(/^save_account: /, '') };
    accountId = found;
  }

  if (date && !DAY.test(date)) return { status: 'error', message: 'That is not a date.' };
  const currentDay = current.occurred_at?.slice(0, 10) ?? '';
  const newScorecard =
    type && version && (type !== current.engagement_type || Number(version) !== current.criteria_version);

  let spent: Spent | null = null;
  if (newScorecard) {
    if (!process.env['ANTHROPIC_API_KEY']) {
      return { status: 'error', message: 'Scoring is not configured on this deployment, so the scorecard cannot change.' };
    }
    const limit = await allowance(supabase, 'api/transcripts');
    if (!limit.allowed) {
      return { status: 'error', message: `Too many calls scored just now. Try again in ${limit.retryAfterSeconds}s.` };
    }
    spent = await spend(supabase, 'calls');
    if (!spent.allowed) return { status: 'error', message: describeRefusal(spent) };
  }

  const { data, error } = await supabase.rpc('edit_conversation', {
    p_conversation_id: id,
    ...(title && title !== current.title ? { p_title: title } : {}),
    ...(date !== currentDay
      ? date
        ? { p_occurred_at: `${date}T12:00:00Z` }
        : { p_clear_date: true }
      : {}),
    ...(newScorecard ? { p_engagement_type: type, p_criteria_version: Number(version) } : {}),
    ...(outcome !== (current.outcome ?? 'unknown') ? { p_outcome: outcome } : {}),
    ...(accountId && accountId !== current.account_id ? { p_account_id: accountId } : {}),
    ...(!accountId && current.account_id ? { p_clear_account: true } : {}),
  });
  if (error) {
    if (spent) await refund(supabase, spent);
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'Only an owner, or whoever added this call, can change it.'
          : error.code === '23503'
            ? 'That scorecard is not one this company can use.'
            : error.message.replace(/^edit_conversation: /, ''),
    };
  }

  const changed = ((data as { changed?: string[] } | null)?.changed ?? []);
  if (changed.includes('scorecard')) {
    const charged = spent;
    after(() =>
      scoreUploadedConversation(supabase, id).then(
        // Too long, or nothing to score: no model was asked, so nothing is owed.
        async (outcome) => {
          if (outcome.status !== 'scored' && charged) await refund(supabase, charged);
        },
        (cause: unknown) => {
          recordFailure(cause, { db: supabase, source: 'conversations/edit/score', tier: 't1', conversationId: id });
        },
      ),
    );
  } else if (spent) {
    await refund(supabase, spent);
  }

  revalidatePath(`/conversations/${id}`);
  revalidatePath('/conversations');
  if (changed.length === 0) return { status: 'saved', message: 'Nothing had changed.' };
  return {
    status: 'saved',
    message: changed.includes('scorecard')
      ? 'Saved. The call is being scored against its new scorecard; reload in a minute.'
      : 'Saved.',
  };
}

export type NoteState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

function noteError(error: { code?: string; message: string }): NoteState {
  return {
    status: 'error',
    message:
      error.code === '42501'
        ? 'Only whoever wrote a note, or an owner, can change it.'
        : error.message.replace(/^(add|edit|delete)_segment_note: /, ''),
  };
}

/** A note on one moment, by any member. */
export async function addNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_segment_note', {
    p_segment_id: text(formData, 'segmentId'),
    p_body: text(formData, 'body'),
  });
  if (error) return noteError(error);
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  return { status: 'saved' };
}

/** Its author rewrites it. */
export async function editNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('edit_segment_note', {
    p_note_id: text(formData, 'noteId'),
    p_body: text(formData, 'body'),
  });
  if (error) return noteError(error);
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  return { status: 'saved' };
}

/** Its author, or an owner, removes it. */
export async function deleteNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_segment_note', { p_note_id: text(formData, 'noteId') });
  if (error) return noteError(error);
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  return { status: 'saved' };
}

export type DisputeState = { status: 'idle' } | { status: 'saved' } | { status: 'error'; message: string };

function disputeError(error: { code?: string; message: string }): DisputeState {
  return {
    status: 'error',
    message:
      error.code === '42501'
        ? 'Only an owner, or whoever added this call, can correct its score.'
        : error.message.replace(/^(dispute_criterion|withdraw_dispute): /, ''),
  };
}

/**
 * "This score is wrong": a correction recorded as evidence from a person —
 * on the words they point at, with their reason — so the engine rescores the
 * call from it as it would from a detector's (see the score_disputes
 * migration for why it is evidence and never a typed number).
 */
export async function disputeScore(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const supabase = await createClient();
  const conversationId = text(formData, 'conversationId');
  const { error } = await supabase.rpc('dispute_criterion', {
    p_conversation_id: conversationId,
    p_criterion_key: text(formData, 'criterion'),
    p_kind: text(formData, 'kind'),
    p_segment_id: text(formData, 'segmentId'),
    p_quote: text(formData, 'quote'),
    p_reason: text(formData, 'reason'),
  });
  if (error) return disputeError(error);
  revalidatePath(`/conversations/${conversationId}`);
  return { status: 'saved' };
}

/** Take a correction back, as its author or an owner. */
export async function withdrawDispute(_prev: DisputeState, formData: FormData): Promise<DisputeState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_dispute', { p_event_id: text(formData, 'eventId') });
  if (error) return disputeError(error);
  revalidatePath(`/conversations/${text(formData, 'conversationId')}`);
  return { status: 'saved' };
}
