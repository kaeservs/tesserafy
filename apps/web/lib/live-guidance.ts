import type { Guidance } from '@tesserafy/ai';
import type { SupabaseClient } from '@tesserafy/db';
import { myCompanyId } from './company';
import { loadGuidance } from './guidance';

/**
 * Scoring guidance for a live call, cached per person for a few minutes.
 *
 * Live detection has a 700 ms budget and runs every utterance; reading the
 * company's guidance each time would spend part of it on the same rows. A
 * correction made mid-call reaches the live scorecard within the cache's
 * life, which is soon enough for something learned between calls.
 *
 * Every call type's lessons: the overlay sends criteria, not its scorecard's
 * name, and the renderer keeps only what is about the criteria in play.
 */
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; guidance: Guidance | null }>();

export async function liveGuidance(db: SupabaseClient, userId: string): Promise<Guidance | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.guidance;
  let guidance: Guidance | null;
  try {
    const companyId = await myCompanyId(db, userId);
    guidance = companyId ? await loadGuidance(db, companyId, 'scoring', null) : null;
  } catch {
    // Guidance improves a detection; it never blocks one.
    guidance = null;
  }
  cache.set(userId, { at: Date.now(), guidance });
  return guidance;
}
