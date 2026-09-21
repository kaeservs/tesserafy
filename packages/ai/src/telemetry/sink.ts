import type { SupabaseClient } from '@tesserafy/db';
import type { UsageEvent, UsageSink } from './usage';

/**
 * A usage sink that keeps the row.
 *
 * The console sink is fine in a terminal and useless in production, where it
 * lands in a log buffer that ages out — so "what did this customer cost last
 * month" stops being answerable about a week after anyone thinks to ask.
 *
 * Recording must never break the thing being measured. A failed insert is
 * reported and swallowed: losing one usage row is a gap in a report, while
 * failing an extraction because its telemetry failed would be absurd.
 */
export interface UsageContext {
  readonly db: SupabaseClient;
  readonly companyId?: string;
  readonly conversationId?: string;
  readonly detector?: string;
  /** Called when recording fails; defaults to a console warning. */
  readonly onError?: (error: Error) => void;
}

export function databaseSink(context: UsageContext): UsageSink {
  return (event: UsageEvent) => {
    void record(event, context);
  };
}

async function record(event: UsageEvent, context: UsageContext): Promise<void> {
  try {
    const { error } = await context.db.rpc('record_model_usage', {
      p_tier: event.tier,
      p_model: event.model,
      p_duration_ms: event.durationMs,
      p_input_tokens: event.inputTokens,
      p_output_tokens: event.outputTokens,
      p_cache_creation_tokens: event.cacheCreationInputTokens,
      p_cache_read_tokens: event.cacheReadInputTokens,
      p_detector: context.detector ?? null,
      p_company_id: context.companyId ?? null,
      p_conversation_id: context.conversationId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (context.onError) context.onError(error);
    else console.warn(`usage not recorded: ${error.message}`);
  }
}

/** Writes to both: the line is useful while watching, the row while asking. */
export function both(...sinks: readonly UsageSink[]): UsageSink {
  return (event: UsageEvent) => {
    for (const sink of sinks) sink(event);
  };
}
