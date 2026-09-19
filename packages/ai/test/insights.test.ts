/**
 * The insight pipeline without a database or a model.
 *
 * The fake client answers the three calls clustering makes: the guarded
 * `match_segments` RPC, and two reads of the company's own tables. What these
 * tests pin is the part that decides whether an insight is honest — which
 * signals it may rest on, and how few it may rest on.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import {
  clusterSignals,
  loadSignals,
  synthesiseInsight,
  toCompanyId,
  writeInsight,
  type ClusterableSignal,
  type Embedder,
  type SignalCluster,
} from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');
const CONVERSATION_1 = 'c1';
const CONVERSATION_2 = 'c2';

function signal(id: string, conversationId: string, kind = 'problem'): ClusterableSignal {
  return {
    id,
    conversationId,
    kind,
    summary: `summary of ${id}`,
    quote: `quote of ${id}`,
  };
}

interface FakeOptions {
  /** segment ids returned by match_segments, per call */
  matches?: string[];
  /** segment id -> signal ids citing it */
  citations?: Record<string, string[]>;
  signalRows?: { id: string; conversation_id: string; kind: string; summary: string }[];
  evidenceRows?: { signal_id: string; quote: string }[];
}

function fakeDb(options: FakeOptions = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  const thenable = <T>(value: T) => ({
    then: (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve),
  });

  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === 'match_segments') {
        const rows = (options.matches ?? []).map((segmentId) => ({
          segment_id: segmentId,
          company_id: args['p_company_id'],
          conversation_id: 'ignored',
          speaker: 'customer',
          start_ms: 0,
          end_ms: 1,
          text: 'text',
          similarity: 0.9,
        }));
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: 'insight-1', error: null });
    },
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return { ...builder, ...thenable(rowsFor(table, null)) };
        },
        in(_column: string, values: string[]) {
          return thenable(rowsFor(table, values));
        },
        ...thenable(rowsFor(table, null)),
      };
      return builder;
    },
  };

  function rowsFor(table: string, segmentIds: string[] | null) {
    if (table === 'signals') return { data: options.signalRows ?? [], error: null };
    if (segmentIds) {
      const ids = segmentIds.flatMap((id) => options.citations?.[id] ?? []);
      return { data: ids.map((signal_id) => ({ signal_id })), error: null };
    }
    return { data: options.evidenceRows ?? [], error: null };
  }

  return { db: db as unknown as SupabaseClient, rpcCalls };
}

const embedder: Embedder = {
  model: 'nomic-embed-text',
  embed: vi.fn<(text: string) => Promise<number[]>>(async () => new Array<number>(768).fill(0.5)),
};

describe('loadSignals', () => {
  it('attaches one quote to each signal', async () => {
    const { db } = fakeDb({
      signalRows: [{ id: 's1', conversation_id: CONVERSATION_1, kind: 'problem', summary: 'sum' }],
      evidenceRows: [
        { signal_id: 's1', quote: 'the first quote' },
        { signal_id: 's1', quote: 'a second quote for the same signal' },
      ],
    });

    const signals = await loadSignals(A, db);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.quote).toBe('the first quote');
  });

  it('returns nothing when the company has no signals', async () => {
    const { db } = fakeDb({ signalRows: [] });

    expect(await loadSignals(A, db)).toEqual([]);
  });
});

describe('clusterSignals', () => {
  it('groups signals whose evidence is similar across conversations', async () => {
    const signals = [
      signal('s1', CONVERSATION_1),
      signal('s2', CONVERSATION_2),
      signal('s3', CONVERSATION_2),
    ];
    const { db } = fakeDb({
      matches: ['seg1'],
      citations: { seg1: ['s1', 's2', 's3'] },
    });

    const clusters = await clusterSignals(A, signals, { db, embedder });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.signals.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(clusters[0]?.conversationIds).toEqual([CONVERSATION_1, CONVERSATION_2]);
  });

  it('drops a cluster confined to one conversation', async () => {
    // Three findings in one call is a well-evidenced signal, not an insight.
    const signals = [
      signal('s1', CONVERSATION_1),
      signal('s2', CONVERSATION_1),
      signal('s3', CONVERSATION_1),
    ];
    const { db } = fakeDb({ matches: ['seg1'], citations: { seg1: ['s1', 's2', 's3'] } });

    expect(await clusterSignals(A, signals, { db, embedder })).toEqual([]);
  });

  it('drops a cluster with too few signals', async () => {
    const signals = [signal('s1', CONVERSATION_1), signal('s2', CONVERSATION_2)];
    const { db } = fakeDb({ matches: ['seg1'], citations: { seg1: ['s1', 's2'] } });

    expect(await clusterSignals(A, signals, { db, embedder })).toEqual([]);
  });

  it('never puts one signal in two clusters', async () => {
    // Otherwise the same finding is written three times, once per seed.
    const signals = [
      signal('s1', CONVERSATION_1),
      signal('s2', CONVERSATION_2),
      signal('s3', CONVERSATION_2),
    ];
    const { db } = fakeDb({ matches: ['seg1'], citations: { seg1: ['s1', 's2', 's3'] } });

    const clusters = await clusterSignals(A, signals, { db, embedder });

    const seen = clusters.flatMap((cluster) => cluster.signals.map((s) => s.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps a problem and a feature request apart', async () => {
    // Related, and not the same finding: one is a complaint, one is an ask.
    const signals = [
      signal('s1', CONVERSATION_1, 'problem'),
      signal('s2', CONVERSATION_2, 'feature_request'),
      signal('s3', CONVERSATION_2, 'feature_request'),
    ];
    const { db } = fakeDb({ matches: ['seg1'], citations: { seg1: ['s1', 's2', 's3'] } });

    const clusters = await clusterSignals(A, signals, { db, embedder });

    expect(clusters).toEqual([]);
  });

  it('asks the vector search for its own tenant only', async () => {
    const signals = [signal('s1', CONVERSATION_1)];
    const { db, rpcCalls } = fakeDb({ matches: [], citations: {} });

    await clusterSignals(A, signals, { db, embedder });

    const match = rpcCalls.find((call) => call.name === 'match_segments');
    expect(match?.args['p_company_id']).toBe(A);
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = fakeDb();

    await expect(clusterSignals('nope' as never, [], { db, embedder })).rejects.toThrow(TypeError);
  });
});

function cluster(ids: string[], conversations: string[]): SignalCluster {
  const signals = ids.map((id, index) => signal(id, conversations[index] ?? conversations[0]!));
  return { seed: signals[0]!, signals, conversationIds: [...new Set(conversations)] };
}

function fakeClient(output: Record<string, unknown> | null, usage = { input_tokens: 10, output_tokens: 5 }) {
  const parse = vi.fn(async (_params: Record<string, unknown>) => ({
    parsed_output: output,
    stop_reason: 'end_turn',
    stop_details: null,
    usage,
  }));
  return { client: { messages: { parse } } as unknown as Parameters<typeof synthesiseInsight>[1]['client'], parse };
}

describe('synthesiseInsight', () => {
  const given = cluster(['s1', 's2', 's3'], [CONVERSATION_1, CONVERSATION_2, CONVERSATION_2]);

  it('returns an insight resting on the signals the model kept', async () => {
    const { client } = fakeClient({
      is_insight: true,
      title: 'Weekly reporting costs a day of work',
      summary: 'Three customers describe the same manual export.',
      signal_ids: ['s1', 's2', 's3'],
    });

    const result = await synthesiseInsight(given, { client, onUsage: () => {} });

    expect(result).toMatchObject({
      title: 'Weekly reporting costs a day of work',
      signalIds: ['s1', 's2', 's3'],
      conversationIds: [CONVERSATION_1, CONVERSATION_2],
    });
  });

  it('rejects an insight citing a signal nobody clustered', async () => {
    // An invented citation is a claim with invented support.
    const { client } = fakeClient({
      is_insight: true,
      title: 'Invented',
      summary: 'x',
      signal_ids: ['s1', 's2', 's99'],
    });

    expect(await synthesiseInsight(given, { client, onUsage: () => {} })).toMatchObject({
      reason: 'invented-signals',
    });
  });

  it('accepts the model declining to find one finding', async () => {
    const { client } = fakeClient({ is_insight: false, title: '', summary: '', signal_ids: [] });

    expect(await synthesiseInsight(given, { client, onUsage: () => {} })).toMatchObject({
      reason: 'declined',
    });
  });

  it('rejects a cluster the model narrowed below the bar', async () => {
    // Checked after narrowing: two signals from one conversation is a signal.
    const { client } = fakeClient({
      is_insight: true,
      title: 'Too narrow',
      summary: 'x',
      signal_ids: ['s2', 's3'],
    });

    expect(await synthesiseInsight(given, { client, onUsage: () => {} })).toMatchObject({
      reason: 'too-narrow',
    });
  });

  it('records usage', async () => {
    const events: { tier: string; inputTokens: number }[] = [];
    const { client } = fakeClient({
      is_insight: true,
      title: 't',
      summary: 's',
      signal_ids: ['s1', 's2', 's3'],
    });

    await synthesiseInsight(given, { client, onUsage: (e) => events.push(e) });

    expect(events[0]).toMatchObject({ tier: 't3', inputTokens: 10 });
  });

  it('fails when the model returns nothing parsable', async () => {
    const { client } = fakeClient(null);

    await expect(synthesiseInsight(given, { client, onUsage: () => {} })).rejects.toThrow(
      /no parsable output/,
    );
  });
});

describe('writeInsight', () => {
  const insight = {
    title: 'Weekly reporting costs a day of work',
    summary: 'Three customers describe the same manual export.',
    signalIds: ['s1', 's2', 's3'],
    conversationIds: [CONVERSATION_1, CONVERSATION_2],
    synthesiser: 't3-synthesise@2026-09-19',
    model: 'claude-opus-5',
  };

  it('writes the insight and its citations in one call', async () => {
    const { db, rpcCalls } = fakeDb();

    expect(await writeInsight(A, insight, { db })).toBe('insight-1');

    const call = rpcCalls.find((c) => c.name === 'store_insight');
    expect(call?.args['p_company_id']).toBe(A);
    expect(call?.args['p_signal_ids']).toEqual(['s1', 's2', 's3']);
  });

  it('refuses an insight with no signals', async () => {
    const { db, rpcCalls } = fakeDb();

    await expect(writeInsight(A, { ...insight, signalIds: [] }, { db })).rejects.toThrow(
      /no signals/,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = fakeDb();

    await expect(writeInsight('nope' as never, insight, { db })).rejects.toThrow(TypeError);
  });
});
