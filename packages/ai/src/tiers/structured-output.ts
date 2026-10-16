import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/**
 * The structured-output format every tier asks for, except that a reply
 * which does not parse comes back as `parsed_output: null` instead of
 * throwing.
 *
 * The SDK's `messages.parse` parses inside the request's own promise, so a
 * reply cut off at max_tokens, a refusal written as prose, or JSON that
 * misses the schema threw before the tier had its response — before the
 * usage was recorded, and before the tier's own refusal and max_tokens
 * checks could name what happened. The call was billed all the same, and
 * cost telemetry cannot be backfilled. With this, every tier records the
 * call first, then refuses it with the reason it already gives.
 */
export function tolerantOutputFormat<T extends z.ZodType>(schema: T) {
  const format = zodOutputFormat(schema);
  return {
    ...format,
    parse: (content: string): z.infer<T> | null => {
      try {
        return format.parse(content);
      } catch {
        return null;
      }
    },
  };
}
