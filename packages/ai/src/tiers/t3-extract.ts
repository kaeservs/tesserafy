/**
 * T3: post-call extraction. One call per conversation, latency-tolerant, on
 * `claude-sonnet-5` (ADR 0002, moved from Opus 5 by ADR 0014).
 *
 * The model proposes; it never decides. It returns claims with verbatim
 * quotes, and every quote is located in the segment it came from before any
 * of it is believed (see ./evidence). Nothing here produces a score —
 * `packages/scoring` does that from evidence, per invariant 1.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { logUsage, toUsageEvent, type UsageSink } from '../telemetry/usage';
import { resolveSignals, type ResolutionResult } from './evidence';
import { isEmpty, renderInstructions, type Guidance } from './guidance';

/**
 * Sonnet 5 since 2026-09-27 (ADR 0014): on the extraction corpus it scored
 * within noise of Opus 5 — F1 85–93% against 88–90%, two runs each — at 58%
 * less per call. Opus remains a model id away for a measurement that needs it.
 */
export const T3_MODEL = 'claude-sonnet-5';

/** A segment as the extractor needs it: identity, attribution, words. */
export interface ExtractableSegment {
  readonly id: string;
  readonly speaker: string | null;
  readonly startMs: number;
  readonly text: string;
}

export interface ExtractOptions {
  readonly client: Anthropic;
  readonly model?: string;
  readonly maxTokens?: number;
  /** Defaults to the structured console logger. */
  readonly onUsage?: UsageSink;
  /**
   * Sampling temperature. Sent only when set.
   *
   * Not defaulted to zero the way T1 is. This tier runs on a model that
   * deprecates the parameter and rejects the whole request for carrying
   * it, which is how pinning it everywhere took three tiers down at once.
   */
  readonly temperature?: number;
  /** The call type and owners' instructions for insights; absent, the prompt is unchanged. */
  readonly guidance?: Guidance | null;
}

export interface ExtractionResult extends ResolutionResult {
  readonly model: string;
  /** Identifies which prompt produced these signals, for Phase 3. */
  readonly detector: string;
}

/** Bumped whenever the prompt or schema changes; stored on every signal. */
export const T3_DETECTOR = 't3-extract@2026-09-19';

const ClaimedSignalSchema = z.object({
  kind: z.enum(['problem', 'feature_request']),
  summary: z.string().describe('One sentence, in the customer’s own terms, not the vendor’s.'),
  confidence: z.number().describe('0 to 1. How certain the transcript supports this.'),
  evidence: z
    .array(
      z.object({
        segment_id: z.string().describe('The id of the segment the quote is taken from.'),
        quote: z
          .string()
          .describe('Copied character for character from that segment. Never paraphrased.'),
      }),
    )
    .describe('At least one. A signal with no evidence is discarded.'),
});

const ExtractionSchema = z.object({
  signals: z.array(ClaimedSignalSchema),
});

const SYSTEM = `You read sales and customer conversations and extract two things: problems the customer has, and features they ask for.

A problem is something that costs the customer time, money, or accuracy today. A feature request is something they say they want, explicitly or by describing what they would do with it.

Rules:

- Extract only what the customer said. Never extract the seller's claims, or your own inference about what the customer probably meant.
- Every signal must quote the transcript. Copy the quote character for character from a single segment, and give that segment's id. Do not join two segments into one quote, tidy grammar, expand contractions, or fix transcription errors — the quote is shown to a user beside the recording, and a quote that does not match what was said destroys their trust in every other quote on the page.
- If you cannot support a claim with an exact quote, do not make the claim.
- One signal per distinct cost. A restatement, a cause, or a number that sizes a problem you have already extracted is more evidence for that signal, not another signal. A useful test: if one change would resolve both, they are one.
- The customer's own constraints — budget cycles, other projects, staffing, capacity — are context, not problems. Extract what hurts their business, not what makes buying difficult.
- Prefer a few well-evidenced signals over many weak ones. An empty list is a valid answer for a conversation that contains no problems or requests.
- confidence is about the evidence, not about how important the signal seems.`;

export async function extractSignals(
  segments: readonly ExtractableSegment[],
  opts: ExtractOptions,
): Promise<ExtractionResult> {
  if (segments.length === 0) {
    throw new Error('extractSignals() was given no segments');
  }

  const model = opts.model ?? T3_MODEL;
  const sink = opts.onUsage ?? logUsage;
  const startedAt = Date.now();

  const response = await opts.client.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16_000,
    ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    system: isEmpty(opts.guidance) ? SYSTEM : `${SYSTEM}\n\n${renderInstructions(opts.guidance)}`,
    messages: [{ role: 'user', content: renderTranscript(segments) }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  // Recorded before anything can throw on the response: a call that happened
  // costs money whether or not its output was usable.
  sink(toUsageEvent('t3', model, response.usage, Date.now() - startedAt));

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `T3 extraction refused: ${response.stop_details?.explanation ?? 'no explanation given'}`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('T3 extraction hit max_tokens; the output was truncated');
  }
  if (!response.parsed_output) {
    throw new Error('T3 extraction returned no parsable output');
  }

  return {
    ...resolveSignals(response.parsed_output.signals, segments),
    model,
    detector: isEmpty(opts.guidance) ? T3_DETECTOR : `${T3_DETECTOR}+guided`,
  };
}

/**
 * The transcript as the model sees it.
 *
 * Segment ids are printed because the model has to cite one per quote. The
 * timestamp is there for the reader of a debug dump, not for the model: the
 * authoritative timing always comes from the segment row.
 */
export function renderTranscript(segments: readonly ExtractableSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${segment.id}] ${clock(segment.startMs)} ${segment.speaker ?? 'unknown'}: ${segment.text}`,
    )
    .join('\n');
}

function clock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
