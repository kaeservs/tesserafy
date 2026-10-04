import Anthropic from '@anthropic-ai/sdk';
import { awaitableDatabaseSink, draftFollowUp, T3_FOLLOW_UP_DRAFTER } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { ourSpeakerNames } from '@/lib/talk';

/**
 * Drafting a call's follow-up email, as the person who asked: their RLS
 * client reads the transcript and the speakers marked as the company's own,
 * their usage is what is recorded, and record_follow_up checks every quote
 * again before storing. The route charges and refunds; this reads, asks and
 * stores.
 */

export type FollowUpOutcome =
  | { readonly status: 'drafted'; readonly lines: number; readonly dropped: number }
  | { readonly status: 'nothing_to_read' }
  | { readonly status: 'not_found' };

export async function draftCallFollowUp(
  db: SupabaseClient,
  conversationId: string,
  client: Anthropic = new Anthropic(),
): Promise<FollowUpOutcome> {
  const { data: call } = await db.from('conversations').select('id, company_id').eq('id', conversationId).maybeSingle();
  if (!call) return { status: 'not_found' };

  const [{ data: rows }, { data: ours }] = await Promise.all([
    db.from('segments').select('id, speaker, start_ms, text').eq('conversation_id', conversationId).order('start_ms'),
    db.from('our_speakers').select('name').eq('company_id', call.company_id),
  ]);
  const segments = (rows ?? []).map((row) => ({ id: row.id, speaker: row.speaker, startMs: row.start_ms, text: row.text }));
  if (segments.length === 0) return { status: 'nothing_to_read' };

  const usage = awaitableDatabaseSink({ db, companyId: call.company_id, conversationId, detector: T3_FOLLOW_UP_DRAFTER });
  const draft = await draftFollowUp(segments, {
    client,
    ourSpeakers: ourSpeakerNames(ours, segments),
    onUsage: usage.sink,
  });
  await usage.settled();

  const { data, error } = await db.rpc('record_follow_up', {
    p_conversation_id: conversationId,
    p_detector: draft.drafter,
    p_model: draft.model,
    p_draft: {
      subject: draft.subject,
      greeting: draft.greeting,
      opening: draft.opening,
      closing: draft.closing,
      lines: draft.lines.map((line) => ({ kind: line.kind, text: line.text, segment_id: line.segmentId, quote: line.quote })),
    },
  });
  if (error) throw new Error(`Recording the follow-up failed: ${error.message}`);
  const counts = data as { recorded?: number; rejected?: number } | null;
  return { status: 'drafted', lines: counts?.recorded ?? 0, dropped: draft.dropped + (counts?.rejected ?? 0) };
}
