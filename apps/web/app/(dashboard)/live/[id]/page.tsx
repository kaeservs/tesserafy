import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveScorecard, type PlayableSegment } from '@/components/live-scorecard';
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
    .select('id, title')
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

  const { title } = conversation as { title: string };

  return (
    <main>
      <p>
        <Link href={`/conversations/${id}`}>← {title}</Link>
      </p>
      <h1>Live scorecard</h1>
      <p className="muted">
        Replaying {segments.length} utterances through the real detector. The score comes from the
        scoring engine, never from the model.
      </p>
      <LiveScorecard segments={segments} />
    </main>
  );
}
