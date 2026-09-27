import type Anthropic from '@anthropic-ai/sdk';
import { detectCriteria, type CriterionPrompt, type DetectableSegment } from '../tiers/t1-detect';
import type { UsageSink } from '../telemetry/usage';

/**
 * T1 over a stored conversation: the windows, and what the detector found in
 * them.
 *
 * This used to live inside scripts/score.ts, which was fine while an operator
 * was the only thing that ever scored a past call. A transcript uploaded from
 * the browser now scores itself, and two copies of the windowing would drift —
 * the day one of them changed its stride, the same meeting would score
 * differently depending on who had uploaded it. So there is one, here, and
 * both callers use it.
 *
 * It detects and returns. It does not write, because the two callers must not
 * write the same way: the CLI holds the service role, and the web app is a
 * signed-in customer whose writes go through `record_criterion_events`, which
 * checks their membership and re-derives every quote's offsets itself. And it
 * produces no score — invariant 1 — only the spans a score is computed from.
 */

/*
 * How a stored call is cut up for T1: large windows, barely overlapping.
 *
 * This used to be the live path's window — three utterances, advancing one at
 * a time — which made an imported call one detector call per utterance: about
 * 500 for an hour-long meeting, up to $0.95 to score, most of a Basic plan's
 * price over its ten imports. Measured on 2026-09-27 against the criteria
 * labels (services/eval/benchmarks/results.md), a call scored in one large
 * window was cheaper *and* better:
 *
 *   ten short calls   rolling 3/1: P 58–60% R 89–93% F1 70–73%
 *                     one window:  P 77%    R 82–86% F1 79–81%   (−60% tokens)
 *   the ten joined,   rolling 3/1: P 39–40% R 100%   F1 57%
 *   47 segments       one window:  P 85%    R 79%    F1 81%      (7× cheaper)
 *
 * Small windows see a sentence without the conversation around it and claim
 * criteria it does not support; latching makes those claims permanent. A
 * window of 48 is the longest that was measured, so a longer call is cut into
 * windows of 48 overlapping by two — enough that a complaint and its cost in
 * the next utterance still share a window at every boundary.
 *
 * The live path is unaffected: it scores the last three utterances as they are
 * spoken (apps/desktop, /api/detect), because there a score must move after
 * every sentence.
 */

/** Utterances per detector call when scoring a stored call. */
export const SCORE_WINDOW_SIZE = 48;
/** How far the window advances: neighbouring windows share two utterances. */
export const SCORE_STRIDE = 46;
/**
 * Output room per window. A 47-utterance window of dense evidence came back at
 * 1,624 tokens; the detector's default cap is sized for three utterances and
 * truncated it mid-JSON.
 */
export const SCORE_MAX_TOKENS = 8192;

/** Windows `windowsOf` would make for this many segments, without building them. */
export function windowCount(
  segments: number,
  stride: number = SCORE_STRIDE,
  size: number = SCORE_WINDOW_SIZE,
): number {
  if (segments <= 0) return 0;
  if (segments <= size) return 1;
  return Math.ceil((segments - size) / Math.max(1, Math.floor(stride))) + 1;
}

export interface StoredSegment {
  readonly id: string;
  readonly speaker: string | null;
  readonly start_ms: number;
  readonly end_ms: number;
  readonly text: string;
}

/**
 * Overlapping windows over a conversation, in order.
 *
 * Overlap is deliberate. A criterion is often established across two
 * utterances — a complaint in one, its cost in the next — and disjoint windows
 * would miss it at a boundary. Latching and the uniqueness constraint make the
 * repeats free. `stride` and `size` default to the product's; the evaluation
 * harness passes others to compare.
 */
export function windowsOf(
  segments: readonly StoredSegment[],
  stride: number = SCORE_STRIDE,
  size: number = SCORE_WINDOW_SIZE,
): DetectableSegment[][] {
  const step = Math.max(1, Math.floor(stride));
  const width = Math.max(1, Math.floor(size));
  const windows: DetectableSegment[][] = [];
  for (let start = 0; start < segments.length; start += step) {
    const slice = segments.slice(start, start + width);
    if (slice.length === 0) break;
    windows.push(
      slice.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text,
      })),
    );
    // The last window is whatever is left; advancing past it would repeat it.
    if (start + width >= segments.length) break;
  }
  return windows;
}

export interface DetectedEvent {
  readonly criterionKey: string;
  readonly kind: 'evidence' | 'contradiction';
  readonly confidence: number;
  readonly segmentId: string;
  readonly quote: string;
  readonly detector: string;
  readonly model: string;
}

export interface ScanOptions {
  readonly client: Anthropic;
  readonly criteria: readonly CriterionPrompt[];
  readonly onUsage?: UsageSink;
  /**
   * Detector calls in flight at once. Sequential is what the CLI always did
   * and is still fine there; the upload path runs inside a serverless function
   * with a time budget, and a 300-utterance call is 300 Haiku round trips.
   */
  readonly concurrency?: number;
  /** Output cap per window; SCORE_MAX_TOKENS unless the caller's windows are smaller. */
  readonly maxTokens?: number;
  /** The detector. Replaced in tests; always detectCriteria otherwise. */
  readonly detect?: typeof detectCriteria;
}

export interface ScanResult {
  readonly events: readonly DetectedEvent[];
  /** Claims the detector made that could not be quoted from the window. */
  readonly rejected: number;
  readonly calls: number;
}

/**
 * Every window through T1, deduplicated.
 *
 * Overlapping windows re-observe the same span two or three times. Sending each
 * copy to be refused by the database would turn one write into a conflict
 * storm, so the strongest observation of each span is kept here. Keyed on the
 * quote rather than on offsets, because the web path never computes offsets —
 * the database derives them — and the same quote in the same segment is the
 * same observation either way.
 */
export async function scanWindows(
  windows: readonly (readonly DetectableSegment[])[],
  opts: ScanOptions,
): Promise<ScanResult> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));
  const best = new Map<string, DetectedEvent>();
  let rejected = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < windows.length) {
      const window = windows[next++]!;
      const result = await (opts.detect ?? detectCriteria)(window, {
        client: opts.client,
        criteria: opts.criteria,
        maxTokens: opts.maxTokens ?? SCORE_MAX_TOKENS,
        ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
      });
      rejected += result.rejected.length;

      for (const event of result.events) {
        const key = `${event.criterionKey}|${event.kind}|${event.span.segmentId}|${event.span.quote}`;
        const existing = best.get(key);
        if (existing && existing.confidence >= event.confidence) continue;
        best.set(key, {
          criterionKey: event.criterionKey,
          kind: event.kind,
          confidence: event.confidence,
          segmentId: event.span.segmentId,
          quote: event.span.quote,
          detector: result.detector,
          model: result.model,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, () => worker()));
  return { events: [...best.values()], rejected, calls: windows.length };
}
