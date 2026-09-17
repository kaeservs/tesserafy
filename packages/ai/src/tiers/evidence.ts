/**
 * Turning what the model claimed into evidence the database will accept.
 *
 * A model asked for a quotation will sometimes paraphrase, tidy the grammar,
 * or attribute a line to the wrong segment. None of that is detectable by
 * reading the output — it reads better than the truth. So every quote is
 * located in the segment it claims to come from, and a signal whose quote
 * cannot be found is dropped rather than stored.
 *
 * This is the same rule the `signal_evidence` trigger enforces in Postgres
 * (ADR 0007). Doing it here too means the pipeline can report how often the
 * model paraphrased — a number Phase 3 needs — instead of just failing.
 */

/** A segment as it was sent to the model. */
export interface QuotableSegment {
  readonly id: string;
  readonly text: string;
}

/** What the model returned, before any of it is believed. */
export interface ClaimedSignal {
  readonly kind: 'problem' | 'feature_request';
  readonly summary: string;
  readonly confidence: number;
  readonly evidence: readonly { readonly segment_id: string; readonly quote: string }[];
}

export interface ResolvedEvidence {
  readonly segmentId: string;
  readonly quote: string;
  /** Character offsets into the segment text: zero-based, end-exclusive. */
  readonly quoteStart: number;
  readonly quoteEnd: number;
}

export interface ResolvedSignal {
  readonly kind: 'problem' | 'feature_request';
  readonly summary: string;
  readonly confidence: number;
  readonly evidence: readonly ResolvedEvidence[];
}

export type RejectionReason =
  | 'unknown-segment'
  | 'quote-not-found'
  | 'no-evidence'
  | 'empty-summary'
  | 'confidence-out-of-range';

export interface RejectedSignal {
  readonly reason: RejectionReason;
  readonly summary: string;
  /** The offending quote, when the rejection was about one. */
  readonly quote?: string;
}

export interface ResolutionResult {
  readonly signals: readonly ResolvedSignal[];
  readonly rejected: readonly RejectedSignal[];
}

export function resolveSignals(
  claims: readonly ClaimedSignal[],
  segments: readonly QuotableSegment[],
): ResolutionResult {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const signals: ResolvedSignal[] = [];
  const rejected: RejectedSignal[] = [];

  for (const claim of claims) {
    if (claim.summary.trim().length === 0) {
      rejected.push({ reason: 'empty-summary', summary: claim.summary });
      continue;
    }
    if (!(Number.isFinite(claim.confidence) && claim.confidence >= 0 && claim.confidence <= 1)) {
      rejected.push({ reason: 'confidence-out-of-range', summary: claim.summary });
      continue;
    }

    const evidence: ResolvedEvidence[] = [];
    let failure: RejectedSignal | null = null;

    for (const item of claim.evidence) {
      const segment = byId.get(item.segment_id);
      if (!segment) {
        // An id that was never in the prompt: the model invented it.
        failure = { reason: 'unknown-segment', summary: claim.summary, quote: item.quote };
        break;
      }

      const span = locate(segment.text, item.quote);
      if (!span) {
        failure = { reason: 'quote-not-found', summary: claim.summary, quote: item.quote };
        break;
      }

      evidence.push({
        segmentId: segment.id,
        // The segment's own words, not the model's copy of them.
        quote: segment.text.slice(span.start, span.end),
        quoteStart: span.start,
        quoteEnd: span.end,
      });
    }

    if (failure) {
      rejected.push(failure);
      continue;
    }
    // The database rejects an unbacked signal at commit; there is no reason to
    // send it one.
    if (evidence.length === 0) {
      rejected.push({ reason: 'no-evidence', summary: claim.summary });
      continue;
    }

    signals.push({
      kind: claim.kind,
      summary: claim.summary.trim(),
      confidence: claim.confidence,
      evidence,
    });
  }

  return { signals, rejected };
}

/**
 * Where the quote sits in the segment, or null.
 *
 * Exact match first. Failing that, one tolerance: runs of whitespace are
 * allowed to differ, since a model re-emitting a line that was wrapped across
 * two cues will often normalise the spacing. Nothing else is forgiven — a
 * changed word is a paraphrase, and the whole point is to catch those.
 */
function locate(text: string, quote: string): { start: number; end: number } | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;

  const exact = text.indexOf(trimmed);
  if (exact !== -1) return { start: exact, end: exact + trimmed.length };

  const pattern = trimmed
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const match = new RegExp(pattern).exec(text);
  if (!match) return null;

  return { start: match.index, end: match.index + match[0].length };
}
