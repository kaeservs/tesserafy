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
      // Omitted rather than sent as null. The argument has `default null` in
      // SQL, so leaving it out produces the same row, and the generated types
      // describe an absent argument rather than a nullable one. Under
      // exactOptionalPropertyTypes an explicit undefined is not absence, which
      // is why this is a spread and not `?? undefined`.
      ...(context.detector ? { p_detector: context.detector } : {}),
      ...(context.companyId ? { p_company_id: context.companyId } : {}),
      ...(context.conversationId ? { p_conversation_id: context.conversationId } : {}),
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (context.onError) context.onError(error);
    else console.warn(`usage not recorded: ${error.message}`);
  }
}

/**
 * A database sink whose writes can be waited for.
 *
 * `databaseSink` fires and forgets, which is right in a long-lived process and
 * wrong in a serverless function: a promise nobody awaits can be cut off when
 * the function freezes after responding. That matters more than a lost cost
 * row here, because a T3 usage row is also how the product knows extraction
 * has run — lose it after a run that found nothing and the button comes back,
 * and a second press pays Opus again for the same answer.
 *
 * Recording still never throws into the caller; `settled()` only waits.
 */
export function awaitableDatabaseSink(context: UsageContext): {
  readonly sink: UsageSink;
  readonly settled: () => Promise<void>;
} {
  const pending: Promise<void>[] = [];
  return {
    sink: (event: UsageEvent) => {
      pending.push(record(event, context));
    },
    settled: async () => {
      await Promise.all(pending);
    },
  };
}

/** Writes to both: the line is useful while watching, the row while asking. */
export function both(...sinks: readonly UsageSink[]): UsageSink {
  return (event: UsageEvent) => {
    for (const sink of sinks) sink(event);
  };
}
