import { fetchCriteria, fetchCriteriaSets } from '@tesserafy/db';
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
 *
 * Which criteria set to score against is now a choice rather than a constant.
 * It was `'discovery'` in three places while only one set existed, which made
 * the table's own convention — a new engagement type is a row — true in the
 * schema and false in the product. A renewal conversation and a discovery
 * call are not the same conversation and should not be scored as if they
 * were.
 *
 * A plain GET form, so the choice survives a reload and can be linked to. No
 * client JavaScript for something the URL already expresses.
 */
export default async function LiveMicPage({
  searchParams,
}: {
  searchParams: Promise<{ engagement?: string; version?: string }>;
}) {
  const { engagement, version } = await searchParams;
  const supabase = await createClient();

  const sets = await fetchCriteriaSets(supabase);
  const chosen =
    sets.find(
      (set) =>
        set.engagementType === engagement &&
        (version === undefined || set.version === Number(version)),
    ) ??
    sets.find((set) => set.engagementType === engagement) ??
    sets[0];

  if (!chosen) {
    // Nothing can be scored at all. Say who fixes it — criteria are published
    // by an operator (`pnpm criteria --add`), never from a browser — rather
    // than rendering an empty scorecard that looks like a bug.
    return (
      <main>
        <h1>Live scorecard, from the microphone</h1>
        <p role="alert">
          Your company has no criteria set up yet, so nothing can be scored. Ask Tesserafy support
          to set one up for you.
        </p>
      </main>
    );
  }

  const criteria = await fetchCriteria(supabase, chosen.engagementType, chosen.version);

  return (
    <main>
      <h1>Live scorecard, from the microphone</h1>

      {sets.length > 1 && (
        <form method="get" className="toolbar" style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="engagement" className="muted">
            Score this call as
          </label>
          <select id="engagement" name="engagement" defaultValue={chosen.engagementType}>
            {sets.map((set) => (
              <option key={`${set.engagementType}/${set.version}`} value={set.engagementType}>
                {set.engagementType} v{set.version} · {set.criteria} criteria
              </option>
            ))}
          </select>
          {/* Submit rather than onChange: a call that silently re-scored
              itself because somebody brushed a dropdown would be worse than
              one extra click. */}
          <button type="submit">Use this set</button>
        </form>
      )}

      <p className="muted">
        Scoring against {criteria.length} criteria ({chosen.engagementType} v{chosen.version}).
        Speech recognition is the browser’s, which means the audio goes to the browser vendor —
        fine for trying this out, not acceptable for a customer call. Spike S2 chooses the real
        one.
      </p>

      <LiveMicrophone
        // Remounts when the set changes, so a scorecard built from one set can
        // never keep folding evidence from another into itself.
        key={`${chosen.engagementType}/${chosen.version}`}
        prompts={toPrompts(criteria)}
        scorecard={toScorecard(criteria)}
      />
    </main>
  );
}
