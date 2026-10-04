import Anthropic from '@anthropic-ai/sdk';
import { awaitableDatabaseSink, extractActionItems, T3_ACTIONS_DETECTOR } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { ourSpeakerNames } from '@/lib/talk';
import { loadGuidance, purposeOf } from './guidance';

/**
 * Finding a call's action items, as the person who asked: their RLS client
 * reads the transcript, the speakers marked as the company's own, and the
 * owners' guidance for action items on this call type; their usage is what
 * is recorded. The route charges and refunds; this reads, asks and stores.
 */

export type ActionOutcome =
  | { readonly status: 'found'; readonly recorded: number; readonly rejected: number }
  | { readonly status: 'nothing_to_read' }
  | { readonly status: 'not_found' };

export async function findActionItems(
  db: SupabaseClient,
  conversationId: string,
  client: Anthropic = new Anthropic(),
): Promise<ActionOutcome> {
  const { data: call } = await db.from('conversations').select('id, company_id, engagement_type').eq('id', conversationId).maybeSingle();
  if (!call) return { status: 'not_found' };

  const [{ data: rows }, { data: ours }] = await Promise.all([
    db.from('segments').select('id, speaker, start_ms, text').eq('conversation_id', conversationId).order('start_ms'),
    db.from('our_speakers').select('name').eq('company_id', call.company_id),
  ]);
  const segments = (rows ?? []).map((row) => ({ id: row.id, speaker: row.speaker, startMs: row.start_ms, text: row.text }));
  if (segments.length === 0) return { status: 'nothing_to_read' };

  const guidance = await loadGuidance(db, call.company_id, 'action_items', call.engagement_type, await purposeOf(db, call.company_id, call.engagement_type));
  const usage = awaitableDatabaseSink({ db, companyId: call.company_id, conversationId, detector: T3_ACTIONS_DETECTOR });
  const result = await extractActionItems(segments, {
    client,
    guidance,
    ourSpeakers: ourSpeakerNames(ours, segments),
    onUsage: usage.sink,
  });
  await usage.settled();

  const { data, error } = await db.rpc('record_action_items', {
    p_conversation_id: conversationId,
    p_detector: result.detector,
    p_model: result.model,
    p_items: result.items.map((item) => ({
      action: item.action,
      owner_side: item.ownerSide,
      owner_name: item.ownerName,
      due: item.due,
      segment_id: item.segmentId,
      quote: item.quote,
    })),
  });
  if (error) throw new Error(`Recording action items failed: ${error.message}`);
  const counts = data as { recorded?: number; rejected?: number } | null;
  return { status: 'found', recorded: counts?.recorded ?? 0, rejected: result.dropped + (counts?.rejected ?? 0) };
}
