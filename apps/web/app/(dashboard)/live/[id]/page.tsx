import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchCriteria } from '@tesserafy/db';
import { LiveScorecard, type PlayableSegment } from '@/components/live-scorecard';
import { toPrompts, toScorecard } from '@/lib/criteria';
import { createClient } from '@/lib/supabase/server';

/**
 * Replays an imported conversation as if it were happening now.
 *
 * P6 is "live path, browser first", and the cheapest honest version of live is
 * a real transcript played back one utterance at a time through the real
 * detector. Everything downstream — the window, the T1 call, the latching
 * state machine, the score — is what a live call will use; only the source of
 * the utterances is pretend.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, title, engagement_type, criteria_version')
    .eq('id', id)
    .maybeSingle();
  if (!conversation) notFound();

  const { data, error } = await supabase
    .from('segments')
    .select('id, speaker, start_ms, end_ms, text')
    .eq('conversation_id', id)
    .order('start_ms');
  if (error) throw new Error(`Could not load the transcript: ${error.message}`);

  const segments: PlayableSegment[] = (
    (data ?? []) as { id: string; speaker: string | null; start_ms: number; end_ms: number; text: string }[]
  ).map((row) => ({
    id: row.id,
    speaker: row.speaker,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
  }));

  const {
    title,
    engagement_type: engagementType,
    criteria_version: criteriaVersion,
  } = conversation as { title: string; engagement_type: string; criteria_version: number };

  // The set this conversation pins, not the default one.
  //
  // This said 'discovery' while only one set existed, which was invisible
  // until a second one did. A call pinned to renewal would be replayed here
  // against discovery criteria while its own page scored it against renewal —
  // the same conversation, two scorecards, no way to tell which was right.
  //
  // Read as the signed-in user like everything else on this page; criteria
  // are reference data, so RLS lets any member read them.
  const criteria = await fetchCriteria(supabase, engagementType, criteriaVersion);

  return (
    <main>
      <p>
        <Link href={`/conversations/${id}`}>← {title}</Link>
      </p>
      <h1>Live scorecard</h1>
      <p className="muted">
        Replaying {segments.length} utterances through the real detector, against{' '}
        {criteria.length} criteria ({engagementType} v{criteriaVersion}). The score comes from the
        scoring engine, never from the model.
      </p>
      <LiveScorecard
        segments={segments}
        prompts={toPrompts(criteria)}
        scorecard={toScorecard(criteria)}
      />
    </main>
  );
}
