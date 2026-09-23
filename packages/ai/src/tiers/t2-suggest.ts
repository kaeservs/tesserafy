/**
 * T2: live suggestions. ADR 0002's fourth tier, on `claude-sonnet-5`.
 *
 * What a suggestion is allowed to be is the whole design of this file.
 *
 * The obvious version — "here is a good question to ask" — invents advice out
 * of nothing, and this product's claim is that nothing is invented. So a
 * suggestion is anchored twice: to a criterion that is *not yet confirmed*
 * (the scorecard says what is missing) and to something the customer already
 * said (the transcript says why it is worth asking now). A suggestion with no
 * quote is refused, the same way a signal with no quote is.
 *
 * Off the critical path, deliberately. The scorecard updates without waiting
 * for this, because a suggestion arriving three seconds late is still useful
 * and a score arriving three seconds late is not. That is why T2 has its own
 * budget (3.5 s) and its own call.
 *
 * It suggests at most one thing. A seller mid-conversation cannot read a list,
 * and a panel of five suggestions is a panel nobody reads.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Scorecard } from '@tesserafy/scoring';
import { z } from 'zod';
import { logUsage, toUsageEvent, type UsageEvent, type UsageSink } from '../telemetry/usage';
import { locate, type QuotableSegment } from './evidence';

export const T2_MODEL = 'claude-sonnet-5';

/** Bumped whenever the prompt changes. Stored with anything measured. */
export const T2_SUGGESTER = 't2-suggest@2026-09-21';

export interface SuggestableSegment extends QuotableSegment {
  readonly speaker: string | null;
}

export interface SuggestOptions {
  readonly client: Anthropic;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly onUsage?: UsageSink;
  /** Sampling temperature. Zero by default — see DetectOptions. */
  readonly temperature?: number;
}

export interface Suggestion {
  /** The criterion this would help confirm. Always one the scorecard lacks. */
  readonly criterionKey: string;
  /** What to ask, in the seller's voice, short enough to read at a glance. */
  readonly ask: string;
  /** Why now — the customer's own words that make this the moment. */
  readonly because: string;
  readonly segmentId: string;
  readonly suggester: string;
  readonly model: string;
  readonly usage: UsageEvent;
}

export type NoSuggestion =
  | { readonly reason: 'nothing-missing'; readonly note: string }
  | { readonly reason: 'declined'; readonly note: string }
  | { readonly reason: 'unquotable'; readonly note: string }
  | { readonly reason: 'unknown-criterion'; readonly note: string };

const SuggestionSchema = z.object({
  worth_asking: z
    .boolean()
    .describe('False when nothing in this window makes an unconfirmed criterion worth raising now.'),
  criterion_key: z.string().describe('One of the unconfirmed criterion keys given.'),
  ask: z.string().describe('One question, under fifteen words, in the seller’s voice.'),
  because: z
    .string()
    .describe('The customer’s words that make this the moment, copied exactly from one segment.'),
  segment_id: z.string().describe('The id of the segment `because` was copied from.'),
});

const SYSTEM = `You help someone running a live customer conversation notice what to ask next. You do not coach, summarise, or comment on how the call is going.

You are given the criteria that are not yet confirmed, and the last few things that were said.

Rules:

- Suggest at most one question, and only when something just said makes it the natural moment. A suggestion that could have been made at any point in the call is noise.
- The question must serve one of the unconfirmed criteria you were given. Never invent a criterion.
- "because" must be the customer's own words, copied exactly from one segment, and you must give that segment's id. If you cannot point at what makes now the moment, there is no suggestion — set worth_asking to false.
- Keep the question under fifteen words. It is read out of the corner of an eye by someone who is listening to another person.
- Never suggest asking about something the customer has already answered.
- Say nothing when nothing is worth saying. Silence costs nothing; a bad suggestion costs the reader's attention during a conversation they are having.`;

export async function suggestNext(
  scorecard: Scorecard,
  window: readonly SuggestableSegment[],
  opts: SuggestOptions,
): Promise<Suggestion | NoSuggestion> {
  if (window.length === 0) {
    throw new Error('suggestNext() was given an empty window');
  }

  const missing = scorecard.criteria.filter((criterion) => criterion.status !== 'confirmed');
  if (missing.length === 0) {
    // Everything is confirmed: there is nothing this can usefully say, and
    // asking a model to find something anyway is how filler gets invented.
    return { reason: 'nothing-missing', note: 'every criterion is confirmed' };
  }

  const model = opts.model ?? T2_MODEL;
  const sink = opts.onUsage ?? logUsage;
  const known = new Set(missing.map((criterion) => criterion.key));
  const startedAt = Date.now();

  const response = await opts.client.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Not yet confirmed:\n${missing
          .map((criterion) => `- ${criterion.key} (${criterion.label}): ${criterion.status}`)
          .join('\n')}\n\nJust said:\n${window
          .map((segment) => `[${segment.id}] ${segment.speaker ?? 'unknown'}: ${segment.text}`)
          .join('\n')}`,
      },
    ],
    output_config: { format: zodOutputFormat(SuggestionSchema) },
  });

  const usage = toUsageEvent('t2', model, response.usage, Date.now() - startedAt);
  sink(usage);

  if (response.stop_reason === 'refusal') {
    throw new Error(`T2 refused: ${response.stop_details?.explanation ?? 'no reason'}`);
  }
  if (!response.parsed_output) {
    throw new Error('T2 returned no parsable output');
  }

  const output = response.parsed_output;
  if (!output.worth_asking) {
    return { reason: 'declined', note: 'nothing in this window made a criterion worth raising' };
  }

  if (!known.has(output.criterion_key)) {
    // Either invented, or aimed at a criterion already confirmed — both mean
    // the suggestion would send someone after something they already have.
    return {
      reason: 'unknown-criterion',
      note: `suggested ${output.criterion_key}, which is not among the unconfirmed criteria`,
    };
  }

  const segment = window.find((candidate) => candidate.id === output.segment_id);
  const span = segment ? locate(segment.text, output.because) : null;
  if (!segment || !span) {
    // The same rule as evidence: a quote that cannot be found is a paraphrase,
    // and a suggestion justified by a paraphrase is a suggestion justified by
    // nothing.
    return {
      reason: 'unquotable',
      note: `"${output.because}" is not in segment ${output.segment_id}`,
    };
  }

  return {
    criterionKey: output.criterion_key,
    ask: output.ask.trim(),
    because: segment.text.slice(span.start, span.end),
    segmentId: segment.id,
    suggester: T2_SUGGESTER,
    model,
    usage,
  };
}
