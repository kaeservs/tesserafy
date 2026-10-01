/**
 * The "Ask your calls" agent, with the model scripted: it searches, is shown
 * lines under aliases, and answers; what survives is only what quotes a line
 * it was shown, word for word. And it stops: after MAX_ROUNDS it must answer.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { askCalls, assertNoTracing, MAX_ROUNDS, TracingEnabled, UnreadableAnswer, type AskSources, type CallLine } from '../src/agents/ask-calls';

const line = (id: string, text: string, startMs = 61_000): CallLine => ({
  segmentId: id,
  conversationId: 'c1',
  title: 'Harbor & Pine discovery',
  occurredAt: '2026-09-12T10:00:00Z',
  startMs,
  speaker: 'Tom Okafor',
  text,
});

function sources(overrides: Partial<AskSources> = {}): AskSources & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchMeaning: async (query) => {
      calls.push(`meaning:${query}`);
      return [line('seg-1', 'Most of Friday. Call it six hours each, so twelve hours a week between them.')];
    },
    searchWords: async (words) => {
      calls.push(`words:${words}`);
      return [];
    },
    readAround: async (segmentId) => {
      calls.push(`around:${segmentId}`);
      return [line('seg-0', 'And how long does that take them?', 48_000), line('seg-1', 'Most of Friday. Call it six hours each, so twelve hours a week between them.')];
    },
    searchDocuments: async () => [{ title: 'Pricing sheet', text: 'Pro is $20 a seat a month.' }],
    ...overrides,
  };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const reply = (...content: unknown[]) => ({ content, usage, stop_reason: 'tool_use' });

function scripted(...replies: ReturnType<typeof reply>[]) {
  const create = vi.fn(async (_body: Anthropic.MessageCreateParams) => {
    const next = replies.shift();
    if (!next) throw new Error('the script ran out');
    return next;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('ask your calls', () => {
  it('searches, then keeps only the points that quote a line it was shown, as the line has it', async () => {
    const { client, create } = scripted(
      reply(toolUse('t1', 'search_calls', { query: 'time spent on reporting' })),
      reply(toolUse('t2', 'read_around', { id: 's1' })),
      reply(
        toolUse('t3', 'answer', {
          points: [
            { text: 'Tom said reporting takes twelve hours a week.', quote: 'so twelve hours  a week', source: 's1' },
            { text: 'They want it automated.', quote: 'we want it automated', source: 's1' },
            { text: 'Made up.', quote: 'anything', source: 's9' },
            { text: 'The question that prompted it.', quote: 'how long does that take them', source: 's2' },
          ],
          note: '',
        }),
      ),
    );
    const src = sources();
    const steps: string[] = [];
    const usages: unknown[] = [];

    const answer = await askCalls('How much time does reporting cost them?', {
      client,
      sources: src,
      onStep: (step) => steps.push(step),
      onUsage: (event) => usages.push(event),
      today: new Date('2026-10-01T00:00:00Z'),
    });

    expect(src.calls).toEqual(['meaning:time spent on reporting', 'around:seg-1']);
    expect(answer.points).toEqual([
      {
        text: 'Tom said reporting takes twelve hours a week.',
        quote: 'so twelve hours a week',
        call: { segmentId: 'seg-1', conversationId: 'c1', title: 'Harbor & Pine discovery', occurredAt: '2026-09-12T10:00:00Z', startMs: 61_000, speaker: 'Tom Okafor' },
        document: null,
      },
      {
        text: 'The question that prompted it.',
        quote: 'how long does that take them',
        call: { segmentId: 'seg-0', conversationId: 'c1', title: 'Harbor & Pine discovery', occurredAt: '2026-09-12T10:00:00Z', startMs: 48_000, speaker: 'Tom Okafor' },
        document: null,
      },
    ]);
    expect(answer.dropped).toBe(2);
    expect(answer.rounds).toBe(3);
    expect(steps).toEqual([
      'Searching your calls for “time spent on reporting”',
      'Reading around a moment in “Harbor & Pine discovery”',
      'Checking every quote',
    ]);
    // Every model call reported, as t3; none sends a temperature.
    expect(usages).toHaveLength(3);
    for (const [body] of create.mock.calls) expect(body).not.toHaveProperty('temperature');
    // The line already seen keeps its alias when it is found again.
    const results = JSON.stringify(create.mock.calls[2]![0].messages);
    expect(results).toContain('[s1]');
    expect(results).toContain('[s2]');
    expect(results).not.toContain('[s3]');
  });

  it('answers from a document only by quoting it, and names the document', async () => {
    const { client } = scripted(
      reply(toolUse('t1', 'search_documents', { query: 'pro price' })),
      reply(
        toolUse('t2', 'answer', {
          points: [
            { text: 'Pro is $20 a seat.', quote: 'Pro is $20 a seat a month.', source: 'k1' },
            { text: 'Pro is $15.', quote: 'Pro is $15 a seat', source: 'k1' },
          ],
          note: '',
        }),
      ),
    );
    const answer = await askCalls('What does Pro cost?', { client, sources: sources() });
    expect(answer.points).toEqual([{ text: 'Pro is $20 a seat.', quote: 'Pro is $20 a seat a month.', call: null, document: 'Pricing sheet' }]);
    expect(answer.dropped).toBe(1);
  });

  it(`must answer after ${MAX_ROUNDS} rounds of searching`, async () => {
    const searches = Array.from({ length: MAX_ROUNDS }, (_, i) => reply(toolUse(`t${i}`, 'search_words', { words: `try ${i}` })));
    const { client, create } = scripted(...searches, reply(toolUse('done', 'answer', { points: [], note: 'No call mentions an audit.' })));

    const answer = await askCalls('Who mentioned the audit?', { client, sources: sources() });

    expect(answer.points).toEqual([]);
    expect(answer.note).toBe('No call mentions an audit.');
    const choices = create.mock.calls.map(([body]) => body.tool_choice);
    expect(choices.slice(0, MAX_ROUNDS)).toEqual(Array(MAX_ROUNDS).fill({ type: 'any' }));
    expect(choices.at(-1)).toEqual({ type: 'tool', name: 'answer' });
  });

  it('tells the agent a search failed, and carries on', async () => {
    const { client, create } = scripted(
      reply(toolUse('t1', 'search_calls', { query: 'x' })),
      reply(toolUse('t2', 'answer', { points: [], note: 'The search did not work.' })),
    );
    const answer = await askCalls('?', {
      client,
      sources: sources({ searchMeaning: async () => { throw new Error('embedder down: secret detail'); } }),
    });
    expect(answer.note).toBe('The search did not work.');
    const shown = JSON.stringify(create.mock.calls[1]![0].messages);
    expect(shown).toContain('That search did not work.');
    expect(shown).not.toContain('secret detail');
  });

  it('refuses to run while LangSmith tracing would send meeting content away', () => {
    expect(() => assertNoTracing({ LANGSMITH_TRACING: 'true' })).toThrow(TracingEnabled);
    expect(() => assertNoTracing({ LANGCHAIN_TRACING_V2: 'TRUE' })).toThrow(TracingEnabled);
    expect(() => assertNoTracing({ LANGSMITH_TRACING: 'false' })).not.toThrow();
    expect(() => assertNoTracing({})).not.toThrow();
  });

  it('reads points sent as a JSON string, and says so when an answer cannot be read at all', async () => {
    const stringified = scripted(
      reply(toolUse('t1', 'search_calls', { query: 'reporting' })),
      reply(
        toolUse('t2', 'answer', {
          points: JSON.stringify([{ text: 'Twelve hours a week.', quote: 'twelve hours a week', source: 's1' }]),
          note: '',
        }),
      ),
    );
    const answer = await askCalls('How long?', { client: stringified.client, sources: sources() });
    expect(answer.points.map((point) => point.quote)).toEqual(['twelve hours a week']);

    const garbled = scripted(reply(toolUse('t1', 'answer', { points: 'not json at all', note: 3 })));
    await expect(askCalls('How long?', { client: garbled.client, sources: sources() })).rejects.toThrow(UnreadableAnswer);
  });
});
