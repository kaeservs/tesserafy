import { fetchCriteria } from '@tesserafy/db';
import { LiveMicrophone } from '@/components/live-microphone';
import { toPrompts, toScorecard } from '@/lib/criteria';
import { createClient } from '@/lib/supabase/server';

/**
 * The live path on a microphone.
 *
 * Everything downstream of the audio is what a real call will use: the same
 * endpointing shape, the same rolling window, the same T1 endpoint, the same
 * latching scorecard. Only the transcription is a stand-in, and it says so on
 * the page rather than in a comment nobody reads.
 */
export default async function LiveMicPage() {
  const supabase = await createClient();
  const criteria = await fetchCriteria(supabase, 'discovery');

  return (
    <main>
      <h1>Live scorecard, from the microphone</h1>
      <p className="muted">
        Scoring against {criteria.length} criteria (discovery v{criteria[0]?.version}). Speech
        recognition is the browser’s, which means the audio goes to the browser vendor — fine for
        trying this out, not acceptable for a customer call. Spike S2 chooses the real one.
      </p>
      <LiveMicrophone prompts={toPrompts(criteria)} scorecard={toScorecard(criteria)} />
    </main>
  );
}
