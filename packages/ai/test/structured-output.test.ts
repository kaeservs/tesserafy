/**
 * A reply that does not parse is still a call that was billed. These drive
 * the real SDK, whose own parse threw before a tier could record usage, with
 * a fetch that returns what the API returns, so nothing is sent anywhere.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tolerantOutputFormat } from '../src/tiers/structured-output';
import { extractSignals } from '../src/tiers/t3-extract';
import type { UsageEvent } from '../src/telemetry/usage';

const USAGE = { input_tokens: 9000, output_tokens: 16000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function apiReturning(text: string, stopReason: string): Anthropic {
  const message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: USAGE,
  };
  return new Anthropic({
    apiKey: 'test',
    maxRetries: 0,
    fetch: async () => new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } }),
  });
}

const SEGMENTS = [{ id: 'seg-1', speaker: 'customer', startMs: 0, text: 'Exporting the report takes all of Friday.' }];

describe('tolerantOutputFormat', () => {
  const schema = z.object({ items: z.array(z.string()) });

  it('parses what fits the schema', () => {
    expect(tolerantOutputFormat(schema).parse('{"items":["a"]}')).toEqual({ items: ['a'] });
  });

  it('gives null for JSON cut off, prose, or the wrong shape', () => {
    const format = tolerantOutputFormat(schema);
    expect(format.parse('{"items":["a", "b')).toBeNull();
    expect(format.parse('I cannot help with that.')).toBeNull();
    expect(format.parse('{"items":[1]}')).toBeNull();
  });

  it('still sends the schema the API needs', () => {
    expect(tolerantOutputFormat(schema).type).toBe('json_schema');
    expect(tolerantOutputFormat(schema).schema).toMatchObject({ type: 'object' });
  });
});

describe('a tier whose reply does not parse', () => {
  it('records the usage of a reply cut off at max_tokens, then says why it failed', async () => {
    const events: UsageEvent[] = [];
    const client = apiReturning('{"signals":[{"kind":"problem","summary":"Exporting', 'max_tokens');

    await expect(extractSignals(SEGMENTS, { client, onUsage: (e) => events.push(e) })).rejects.toThrow(/max_tokens/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tier: 't3', inputTokens: 9000, outputTokens: 16000 });
  });

  it('records the usage of a refusal written as prose, then says it was refused', async () => {
    const events: UsageEvent[] = [];
    const client = apiReturning('I would rather not.', 'refusal');

    await expect(extractSignals(SEGMENTS, { client, onUsage: (e) => events.push(e) })).rejects.toThrow(/refused/);
    expect(events).toHaveLength(1);
  });
});
