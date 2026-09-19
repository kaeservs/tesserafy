/**
 * T1: criterion detection over a rolling window. Spike S3.
 *
 * Budget is 700 ms (ADR 0002), so this is `claude-haiku-4-5` with no thinking
 * and a small output. It returns DetectorEvents — the exact type
 * `packages/scoring` consumes — so a detector cannot produce a score even by
 * accident (invariant 1). Whether a criterion is confirmed is decided later,
 * by a pure function, from these spans.
 *
 * Caching matters more here than anywhere else in the product: a 45-minute
 * call makes roughly 135 of these, and each one re-sends the criteria
 * definitions. The frozen prefix (system + criteria) is marked cacheable and
 * the rolling window follows it, never the other way round. The result
 * reports `cacheReadInputTokens` so a silent cache miss shows up as a number
 * rather than as a surprise on a bill.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DetectorEvent } from '@tesserafy/scoring';
import { z } from 'zod';
import { logUsage, toUsageEvent, type UsageEvent, type UsageSink } from '../telemetry/usage';
import { locate, type QuotableSegment, type RejectedSignal } from './evidence';

export const T1_MODEL = 'claude-haiku-4-5';

/** Bumped whenever the prompt or the criteria phrasing changes. */
export const T1_DETECTOR = 't1-detect@2026-09-19';

/** One criterion, as the detector is told about it. */
export interface CriterionPrompt {
  readonly key: string;
  readonly label: string;
  /** What counts as evidence, in a sentence. This is the whole prompt. */
  readonly definition: string;
}

export interface DetectableSegment extends QuotableSegment {
  readonly speaker: string | null;
  readonly startMs: number;
  readonly endMs: number;
}

export interface DetectOptions {
  readonly client: Anthropic;
  readonly criteria: readonly CriterionPrompt[];
  readonly model?: string;
  readonly maxTokens?: number;
  readonly onUsage?: UsageSink;
  /**
   * 'compact' asks for the shortest quote that carries the evidence, and caps
   * how many observations a window may report. Spike S3 measures whether that
   * buys back the latency budget: the response is written token by token, so
   * output length is most of the wall clock.
   */
  readonly variant?: 'full' | 'compact';
}

export interface DetectionResult {
  readonly events: readonly DetectorEvent[];
  /** Claims dropped because their quote was not in the window verbatim. */
  readonly rejected: readonly RejectedSignal[];
  readonly model: string;
  readonly detector: string;
  readonly usage: UsageEvent;
}

const ObservationSchema = z.object({
  criterion_key: z.string().describe('Exactly one of the keys given in the system prompt.'),
  polarity: z
    .enum(['supports', 'contradicts'])
    .describe('supports: the window is evidence for the criterion. contradicts: the window is explicit evidence against it.'),
  confidence: z.number().describe('0 to 1.'),
  segment_id: z.string().describe('The id of the segment the quote is taken from.'),
  quote: z.string().describe('Copied character for character from that segment.'),
});

const DetectionSchema = z.object({ observations: z.array(ObservationSchema) });

/**
 * The frozen prefix. Everything here must be identical on every call of a
 * conversation — no timestamps, no ids, no counts — or the cache never hits
 * and the live cost model is wrong by an order of magnitude.
 */
export function systemPrompt(
  criteria: readonly CriterionPrompt[],
  variant: 'full' | 'compact' = 'full',
): string {
  const list = criteria
    .map((criterion) => `- ${criterion.key} (${criterion.label}): ${criterion.definition}`)
    .join('\n');

  return `You watch a live sales conversation and report evidence for a fixed list of criteria. You never judge whether a criterion is met — you report what was said and how strongly it bears on each criterion. Something else decides.

Criteria:

${list}

Rules:

- Report an observation only when this window contains evidence for one of the criteria above. Most windows contain none; an empty list is the normal answer.
- Quote the window character for character, from a single segment, and give that segment's id. Never paraphrase, tidy or join segments.
- Report the customer's words, not the seller's questions. A seller asking "what's your timeline?" is not evidence of a timeline.
- Use "contradicts" only for an explicit statement against a criterion — "we have no budget for this", not the absence of any mention. Silence is never evidence.
- confidence is how strongly these exact words support the criterion, not how important it seems.${
    variant === 'compact'
      ? `
- Quote the shortest phrase that carries the evidence — at most ten words. A longer quote is not stronger evidence.
- Report at most three observations, the strongest ones. This window will be seen again with more context.`
      : ''
  }`;
}

export async function detectCriteria(
  window: readonly DetectableSegment[],
  opts: DetectOptions,
): Promise<DetectionResult> {
  if (window.length === 0) {
    throw new Error('detectCriteria() was given an empty window');
  }
  if (opts.criteria.length === 0) {
    throw new Error('detectCriteria() was given no criteria');
  }

  const model = opts.model ?? T1_MODEL;
  const sink = opts.onUsage ?? logUsage;
  const known = new Set(opts.criteria.map((criterion) => criterion.key));
  const startedAt = Date.now();

  const response = await opts.client.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    // The cache breakpoint. Everything before it is frozen; the window below
    // is what changes every call.
    system: [
      {
        type: 'text',
        text: systemPrompt(opts.criteria, opts.variant ?? 'full'),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: renderWindow(window) }],
    output_config: { format: zodOutputFormat(DetectionSchema) },
  });

  const usage = toUsageEvent('t1', model, response.usage, Date.now() - startedAt);
  sink(usage);

  if (response.stop_reason === 'refusal') {
    throw new Error(`T1 detection refused: ${response.stop_details?.explanation ?? 'no reason'}`);
  }
  if (!response.parsed_output) {
    throw new Error('T1 detection returned no parsable output');
  }

  const byId = new Map(window.map((segment) => [segment.id, segment]));
  const events: DetectorEvent[] = [];
  const rejected: RejectedSignal[] = [];

  for (const observation of response.parsed_output.observations) {
    const summary = `${observation.criterion_key}: ${observation.quote}`;

    if (!known.has(observation.criterion_key)) {
      // An invented criterion key would land in the scorecard as a criterion
      // nobody defined; apply() throws on it, so drop it here with a reason.
      rejected.push({ reason: 'unknown-segment', summary, quote: observation.quote });
      continue;
    }
    if (!(observation.confidence >= 0 && observation.confidence <= 1)) {
      rejected.push({ reason: 'confidence-out-of-range', summary });
      continue;
    }

    const segment = byId.get(observation.segment_id);
    if (!segment) {
      rejected.push({ reason: 'unknown-segment', summary, quote: observation.quote });
      continue;
    }

    const span = locate(segment.text, observation.quote);
    if (!span) {
      rejected.push({ reason: 'quote-not-found', summary, quote: observation.quote });
      continue;
    }

    events.push({
      kind: observation.polarity === 'contradicts' ? 'contradiction' : 'evidence',
      criterionKey: observation.criterion_key,
      confidence: observation.confidence,
      span: {
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        quote: segment.text.slice(span.start, span.end),
      },
    });
  }

  const detector = opts.variant === 'compact' ? `${T1_DETECTOR}-compact` : T1_DETECTOR;
  return { events, rejected, model, detector, usage };
}

/** The volatile half of the request: everything after the cache breakpoint. */
export function renderWindow(window: readonly DetectableSegment[]): string {
  return window
    .map((segment) => `[${segment.id}] ${segment.speaker ?? 'unknown'}: ${segment.text}`)
    .join('\n');
}
