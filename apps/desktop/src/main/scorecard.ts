/**
 * Which scorecard the overlay scores against.
 *
 * It was one name, `discovery`, fixed at build time (TESSERAFY_ENGAGEMENT
 * could change it, which nobody outside a terminal can). Companies now write
 * their own scorecards (ADR 0016), so the overlay asks which ones the signed-in
 * person may use and remembers the choice on this computer — a name, not a
 * version, so publishing the next version is picked up without choosing again.
 *
 * Pure: the main process reads and writes the file; this decides.
 */

export interface ScorecardChoice {
  readonly engagementType: string;
  readonly version: number;
  readonly own: boolean;
  readonly label: string;
}

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;

/** A name as it may be stored or sent, or null. */
export function scorecardName(value: unknown): string | null {
  return typeof value === 'string' && NAME.test(value) ? value : null;
}

/** The remembered name if it is still offered; otherwise the company's own first set, the fallback, or the first. */
export function chooseScorecard(
  offered: readonly ScorecardChoice[],
  remembered: string | null,
  fallback: string,
): string | null {
  if (offered.length === 0) return remembered ?? fallback;
  const names = new Set(offered.map((set) => set.engagementType));
  if (remembered && names.has(remembered)) return remembered;
  const own = offered.find((set) => set.own);
  if (own) return own.engagementType;
  if (names.has(fallback)) return fallback;
  return offered[0]!.engagementType;
}

/** The list as the endpoint returned it, keeping only well-formed entries. */
export function parseScorecards(body: unknown): ScorecardChoice[] {
  const sets = (body as { sets?: unknown } | null)?.sets;
  if (!Array.isArray(sets)) return [];
  return sets.flatMap((set: unknown) => {
    const row = set as Partial<ScorecardChoice> | null;
    const name = scorecardName(row?.engagementType);
    if (!name || typeof row?.version !== 'number' || typeof row.label !== 'string') return [];
    return [{ engagementType: name, version: row.version, own: row.own === true, label: row.label }];
  });
}
