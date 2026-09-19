/**
 * T1 without the API. What matters here is the shape of the request — the
 * frozen prefix has to stay frozen or live cost multiplies — and that nothing
 * the model says becomes a DetectorEvent until its quote is found.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  detectCriteria,
  systemPrompt,
  T1_MODEL,
  type CriterionPrompt,
  type DetectableSegment,
} from '../src/tiers/t1-detect';

const CRITERIA: CriterionPrompt[] = [
  {
    key: 'pain_quantified',
    label: 'Pain quantified',
    definition: 'The customer states a cost in time, money or accuracy.',
  },
  {
    key: 'timeline_stated',
    label: 'Timeline stated',
    definition: 'The customer names a date, deadline or period.',
  },
];

const WINDOW: DetectableSegment[] = [
  {
    id: 'w1',
    speaker: 'customer',
    startMs: 61_000,
    endMs: 68_500,
    text: 'Exporting the weekly report takes us most of Friday afternoon.',
  },
  {
    id: 'w2',
    speaker: 'seller',
    startMs: 69_000,
    endMs: 72_000,
    text: 'And when would you want this live?',
  },
];

const USAGE = {
  input_tokens: 120,
  output_tokens: 60,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 900,
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    criterion_key: 'pain_quantified',
    polarity: 'supports',
    confidence: 0.82,
    segment_id: 'w1',
    quote: 'takes us most of Friday afternoon',
    ...overrides,
  };
}

function fakeClient(response: Record<string, unknown> = {}) {
  const parsed = 'parsed_output' in response ? response['parsed_output'] : { observations: [] };
  const parse = vi.fn(async (_params: Record<string, unknown>) => ({
    parsed_output: parsed,
    stop_reason: response['stop_reason'] ?? 'end_turn',
    stop_details: response['stop_details'] ?? null,
    usage: response['usage'] ?? USAGE,
  }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe('detectCriteria', () => {
  it('returns DetectorEvents the scoring package can consume', async () => {
    const { client } = fakeClient({ parsed_output: { observations: [observation()] } });

    const result = await detectCriteria(WINDOW, {
      client,
      criteria: CRITERIA,
      onUsage: () => {},
    });

    expect(result.events).toEqual([
      {
        kind: 'evidence',
        criterionKey: 'pain_quantified',
        confidence: 0.82,
        span: {
          segmentId: 'w1',
          startMs: 61_000,
          endMs: 68_500,
          quote: 'takes us most of Friday afternoon',
        },
      },
    ]);
  });

  it('maps an explicit negative to a contradiction, not to silence', async () => {
    const { client } = fakeClient({
      parsed_output: {
        observations: [observation({ polarity: 'contradicts', quote: 'Exporting the weekly report' })],
      },
    });

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.events[0]?.kind).toBe('contradiction');
  });

  it('drops an observation whose quote is not in the window', async () => {
    const { client } = fakeClient({
      parsed_output: { observations: [observation({ quote: 'eats most of Friday' })] },
    });

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.events).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason: 'quote-not-found' });
  });

  it('drops a criterion key nobody defined', async () => {
    // apply() throws on an unknown criterion, so it must never get one.
    const { client } = fakeClient({
      parsed_output: { observations: [observation({ criterion_key: 'vibes' })] },
    });

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('drops a confidence outside 0..1', async () => {
    const { client } = fakeClient({
      parsed_output: { observations: [observation({ confidence: 1.4 })] },
    });

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.rejected[0]).toMatchObject({ reason: 'confidence-out-of-range' });
  });

  it('treats an empty result as the normal answer', async () => {
    const { client } = fakeClient();

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.events).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('puts the criteria in the cached prefix and the window after it', async () => {
    const { client, parse } = fakeClient();

    await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    const params = parse.mock.calls[0]![0] as unknown as {
      model: string;
      system: { text: string; cache_control?: { type: string } }[];
      messages: { content: string }[];
    };
    expect(params.model).toBe(T1_MODEL);
    expect(params.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0]?.text).toContain('pain_quantified');
    // The window must not leak into the cached half.
    expect(params.system[0]?.text).not.toContain('Friday afternoon');
    expect(params.messages[0]?.content).toContain('w1');
  });

  it('reports cache reads so a silent cache miss is visible', async () => {
    const { client } = fakeClient();

    const result = await detectCriteria(WINDOW, { client, criteria: CRITERIA, onUsage: () => {} });

    expect(result.usage.cacheReadInputTokens).toBe(900);
    expect(result.usage.tier).toBe('t1');
  });

  it('refuses an empty window or an empty criteria set', async () => {
    const { client } = fakeClient();

    await expect(detectCriteria([], { client, criteria: CRITERIA })).rejects.toThrow(/empty window/);
    await expect(detectCriteria(WINDOW, { client, criteria: [] })).rejects.toThrow(/no criteria/);
  });
});

describe('systemPrompt', () => {
  it('is byte-identical for the same criteria', () => {
    // Any per-call variation here — a timestamp, a count, an id — silently
    // destroys the prefix cache and multiplies live cost.
    expect(systemPrompt(CRITERIA)).toBe(systemPrompt(CRITERIA));
  });

  it('contains every criterion key and definition', () => {
    const prompt = systemPrompt(CRITERIA);

    for (const criterion of CRITERIA) {
      expect(prompt).toContain(criterion.key);
      expect(prompt).toContain(criterion.definition);
    }
  });
});
