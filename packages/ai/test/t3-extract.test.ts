/**
 * T3 without the API. The fake client returns what a model would have
 * returned, so these tests cover the parts that are ours: the prompt, the
 * usage record, and what happens to output that cannot be trusted.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  extractSignals,
  renderTranscript,
  T3_DETECTOR,
  T3_MODEL,
  type ExtractableSegment,
} from '../src/tiers/t3-extract';
import type { UsageEvent } from '../src/telemetry/usage';

const SEGMENTS: ExtractableSegment[] = [
  {
    id: 'seg-1',
    speaker: 'customer',
    startMs: 61_000,
    text: 'Exporting the weekly report takes us most of Friday afternoon.',
  },
  {
    id: 'seg-2',
    speaker: null,
    startMs: 125_500,
    text: 'We would love to just get it in Slack automatically.',
  },
];

const USAGE = {
  input_tokens: 1200,
  output_tokens: 300,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 800,
};

function fakeClient(
  response: Partial<{
    parsed_output: unknown;
    stop_reason: string;
    stop_details: { explanation: string } | null;
    usage: typeof USAGE;
  }> = {},
) {
  // `parsed_output` is honoured when present even if it is null — the case a
  // test below pins.
  const parsedOutput = 'parsed_output' in response ? response.parsed_output : { signals: [] };
  const parse = vi.fn(async (_params: Record<string, unknown>) => ({
    parsed_output: parsedOutput,
    stop_reason: response.stop_reason ?? 'end_turn',
    stop_details: response.stop_details ?? null,
    usage: response.usage ?? USAGE,
  }));
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

function goodSignal() {
  return {
    kind: 'problem',
    summary: 'The weekly export costs most of a Friday.',
    confidence: 0.86,
    evidence: [{ segment_id: 'seg-1', quote: 'takes us most of Friday afternoon' }],
  };
}

describe('extractSignals', () => {
  it('returns resolved signals with the detector that produced them', async () => {
    const { client } = fakeClient({ parsed_output: { signals: [goodSignal()] } });

    const result = await extractSignals(SEGMENTS, { client, onUsage: () => {} });

    expect(result.detector).toBe(T3_DETECTOR);
    expect(result.model).toBe(T3_MODEL);
    expect(result.signals[0]?.evidence[0]).toMatchObject({
      segmentId: 'seg-1',
      quoteStart: 28,
      quoteEnd: 61,
    });
  });

  it('drops a paraphrased claim and reports it', async () => {
    const paraphrased = {
      ...goodSignal(),
      evidence: [{ segment_id: 'seg-1', quote: 'eats most of their Friday' }],
    };
    const { client } = fakeClient({ parsed_output: { signals: [paraphrased] } });

    const result = await extractSignals(SEGMENTS, { client, onUsage: () => {} });

    expect(result.signals).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason: 'quote-not-found' });
  });

  it('records usage on every call', async () => {
    const events: UsageEvent[] = [];
    const { client } = fakeClient();

    await extractSignals(SEGMENTS, { client, onUsage: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tier: 't3',
      model: T3_MODEL,
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 800,
    });
    expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records usage even when the response is unusable', async () => {
    // The call was billed whether or not its output could be used.
    const events: UsageEvent[] = [];
    const { client } = fakeClient({ stop_reason: 'max_tokens' });

    await expect(
      extractSignals(SEGMENTS, { client, onUsage: (e) => events.push(e) }),
    ).rejects.toThrow(/max_tokens/);
    expect(events).toHaveLength(1);
  });

  it('fails on a refusal rather than returning nothing found', async () => {
    const { client } = fakeClient({
      stop_reason: 'refusal',
      stop_details: { explanation: 'declined' },
    });

    await expect(extractSignals(SEGMENTS, { client, onUsage: () => {} })).rejects.toThrow(
      /refused: declined/,
    );
  });

  it('fails when the output could not be parsed', async () => {
    const { client } = fakeClient({ parsed_output: null });

    await expect(extractSignals(SEGMENTS, { client, onUsage: () => {} })).rejects.toThrow(
      /no parsable output/,
    );
  });

  it('treats an empty list as a valid extraction', async () => {
    const { client } = fakeClient({ parsed_output: { signals: [] } });

    const result = await extractSignals(SEGMENTS, { client, onUsage: () => {} });

    expect(result.signals).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('sends the transcript and asks for opus by default', async () => {
    const { client, parse } = fakeClient();

    await extractSignals(SEGMENTS, { client, onUsage: () => {} });

    const params = parse.mock.calls[0]![0] as unknown as {
      model: string;
      system: string;
      messages: { content: string }[];
    };
    expect(params.model).toBe('claude-opus-5');
    expect(params.system).toContain('character for character');
    expect(params.messages[0]?.content).toContain('seg-1');
  });

  it('refuses a transcript with no segments before calling the model', async () => {
    const { client, parse } = fakeClient();

    await expect(extractSignals([], { client, onUsage: () => {} })).rejects.toThrow(/no segments/);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('renderTranscript', () => {
  it('prints the id, a clock time, the speaker and the words', () => {
    expect(renderTranscript(SEGMENTS)).toBe(
      '[seg-1] 01:01 customer: Exporting the weekly report takes us most of Friday afternoon.\n' +
        '[seg-2] 02:05 unknown: We would love to just get it in Slack automatically.',
    );
  });
});
