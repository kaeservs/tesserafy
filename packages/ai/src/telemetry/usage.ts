/**
 * Every model call reports what it cost. Cost telemetry cannot be
 * backfilled — a call made without recording its usage is a call nobody can
 * ever price — so this is not optional plumbing to add once there is traffic.
 */

export interface UsageLike {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

export interface UsageEvent {
  /** Which tier made the call: 't1', 't2' or 't3'. */
  readonly tier: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly durationMs: number;
}

export type UsageSink = (event: UsageEvent) => void;

/**
 * The default sink. One line per call, structured, so it survives being
 * shipped to a log aggregator later without anyone re-parsing prose.
 */
export const logUsage: UsageSink = (event) => {
  console.info(JSON.stringify({ event: 'model.usage', ...event }));
};

export function toUsageEvent(
  tier: string,
  model: string,
  usage: UsageLike | null | undefined,
  durationMs: number,
): UsageEvent {
  return {
    tier,
    model,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    durationMs,
  };
}
