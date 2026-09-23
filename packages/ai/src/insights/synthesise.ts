/**
 * T3 synthesis: turning a cluster of signals into one insight.
 *
 * The model names the finding and writes the sentence a product person reads.
 * It does not decide what the evidence is — it may only *narrow* the cluster
 * it was given, never add to it, and every id it returns is checked against
 * what was sent. An insight citing a signal nobody clustered would be a claim
 * with invented support, which is the failure this whole pipeline is built to
 * make impossible.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { logUsage, toUsageEvent, type UsageSink } from '../telemetry/usage';
import type { SignalCluster } from './cluster';

export const T3_SYNTHESISER = 't3-synthesise@2026-09-19';
export const T3_SYNTHESIS_MODEL = 'claude-opus-5';

export interface SynthesiseOptions {
  readonly client: Anthropic;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly onUsage?: UsageSink;
  /** Signals an insight must keep after the model narrows it. Default 3. */
  readonly minSignals?: number;
  /** Distinct conversations it must still span. Default 2. */
  readonly minConversations?: number;
  /** Sampling temperature. Zero by default — see DetectOptions. */
  readonly temperature?: number;
}

export interface SynthesisedInsight {
  readonly title: string;
  readonly summary: string;
  readonly signalIds: readonly string[];
  readonly conversationIds: readonly string[];
  readonly synthesiser: string;
  readonly model: string;
}

export type RejectedCluster =
  | { readonly reason: 'declined'; readonly note: string }
  | { readonly reason: 'too-narrow'; readonly note: string }
  | { readonly reason: 'invented-signals'; readonly note: string };

const InsightSchema = z.object({
  is_insight: z
    .boolean()
    .describe('False when these signals do not describe one finding. Prefer false over a vague insight.'),
  title: z.string().describe('Six to ten words, in the customers’ terms.'),
  summary: z
    .string()
    .describe('Two or three sentences: what several customers are saying, and what it implies.'),
  signal_ids: z
    .array(z.string())
    .describe('The subset of the given signal ids this insight actually rests on.'),
});

const SYSTEM = `You are given several signals extracted from different customer conversations, already evidenced by quotes. Your job is to say whether they are one finding, and if so, to name it.

Rules:

- Use only the signals given. Never cite an id that is not in the list, and never invent a signal.
- Narrow freely. If only four of six belong to the finding, return those four.
- One finding per insight. If the signals describe two different problems, pick the stronger one and return only its signals.
- Write the title in the customers' terms, not the product's. "Weekly reporting costs a day of work" beats "Reporting inefficiency opportunity".
- The summary says what customers are saying and what follows from it. No recommendations, no pricing, no speculation about deals.
- If the signals do not hang together, set is_insight to false. A weak insight is worse than none: it teaches the reader to distrust the list.`;

export async function synthesiseInsight(
  cluster: SignalCluster,
  opts: SynthesiseOptions,
): Promise<SynthesisedInsight | RejectedCluster> {
  const model = opts.model ?? T3_SYNTHESIS_MODEL;
  const sink = opts.onUsage ?? logUsage;
  const minSignals = opts.minSignals ?? 3;
  const minConversations = opts.minConversations ?? 2;
  const startedAt = Date.now();

  const response = await opts.client.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16_000,
    temperature: opts.temperature ?? 0,
    system: SYSTEM,
    messages: [{ role: 'user', content: renderCluster(cluster) }],
    output_config: { format: zodOutputFormat(InsightSchema) },
  });

  sink(toUsageEvent('t3', model, response.usage, Date.now() - startedAt));

  if (response.stop_reason === 'refusal') {
    throw new Error(`Synthesis refused: ${response.stop_details?.explanation ?? 'no reason'}`);
  }
  if (!response.parsed_output) {
    throw new Error('Synthesis returned no parsable output');
  }

  const output = response.parsed_output;
  if (!output.is_insight) {
    return { reason: 'declined', note: output.title || 'the model found no single finding' };
  }

  const given = new Set(cluster.signals.map((signal) => signal.id));
  const invented = output.signal_ids.filter((id) => !given.has(id));
  if (invented.length > 0) {
    return {
      reason: 'invented-signals',
      note: `cited ${invented.length} signal id(s) that were not in the cluster`,
    };
  }

  const kept = cluster.signals.filter((signal) => output.signal_ids.includes(signal.id));
  const conversationIds = [...new Set(kept.map((signal) => signal.conversationId))];

  // Checked after narrowing, not before: the model can prune a cluster below
  // the bar, and a "cross-conversation insight" resting on one conversation
  // is a signal wearing a bigger word.
  if (kept.length < minSignals || conversationIds.length < minConversations) {
    return {
      reason: 'too-narrow',
      note: `${kept.length} signal(s) across ${conversationIds.length} conversation(s) after narrowing`,
    };
  }

  return {
    title: output.title.trim(),
    summary: output.summary.trim(),
    signalIds: kept.map((signal) => signal.id),
    conversationIds,
    synthesiser: T3_SYNTHESISER,
    model,
  };
}

/** The cluster as the model sees it. Ids are what it must cite back. */
export function renderCluster(cluster: SignalCluster): string {
  return cluster.signals
    .map(
      (signal) =>
        `[${signal.id}] (${signal.kind}, conversation ${signal.conversationId})\n` +
        `  summary: ${signal.summary}\n` +
        `  quote: "${signal.quote}"`,
    )
    .join('\n\n');
}
