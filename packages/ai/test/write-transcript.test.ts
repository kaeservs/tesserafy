/**
 * The writer without a database. The fake below implements only the few
 * supabase-js calls the writer makes, and records them, so these tests can
 * assert what would have been written — including the tenant on every row.
 */
import type { SupabaseClient } from '@tesserafy/db';
import type { SegmentDraft } from '@tesserafy/ingest';
import { describe, expect, it, vi } from 'vitest';
import { storeSegmentEmbeddings, toCompanyId, writeTranscript, type Embedder } from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');
const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000a1';

interface Recorded {
  table: string;
  op: 'insert' | 'delete';
  payload?: unknown;
}

interface FakeOptions {
  /** Return segment rows in this order, by draft index. */
  segmentOrder?: number[];
  failOn?: 'conversation' | 'segments' | 'embeddings';
}

function createFakeDb(drafts: readonly SegmentDraft[], options: FakeOptions = {}) {
  const calls: Recorded[] = [];
  const error = (message: string) => ({ data: null, error: { message } });

  const thenable = <T>(value: T) => ({
    then: (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve),
  });

  const db = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });

          if (table === 'conversations') {
            const result =
              options.failOn === 'conversation'
                ? error('conversations insert failed')
                : { data: { id: CONVERSATION_ID }, error: null };
            return { select: () => ({ single: async () => result }) };
          }

          if (table === 'segments') {
            if (options.failOn === 'segments') {
              return { select: () => thenable(error('segments insert failed')) };
            }
            const order = options.segmentOrder ?? drafts.map((_, i) => i);
            const rows = order.map((i) => ({
              id: `seg-${i}`,
              start_ms: drafts[i]!.startMs,
              text: drafts[i]!.text,
            }));
            return { select: () => thenable({ data: rows, error: null }) };
          }

          // segment_embeddings
          return thenable(
            options.failOn === 'embeddings' ? error('embeddings insert failed') : { error: null },
          );
        },
        delete() {
          calls.push({ table, op: 'delete' });
          const eq = () => ({ eq, ...thenable({ error: null }) });
          return { eq };
        },
      };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

function fakeEmbedder(overrides: Partial<Embedder> = {}): Embedder {
  return {
    model: 'nomic-embed-text',
    embed: vi.fn(async () => new Array<number>(768).fill(0.5)),
    ...overrides,
  };
}

function draft(index: number, text: string, startMs: number): SegmentDraft {
  return { index, speaker: 'customer', startMs, endMs: startMs + 1000, text };
}

const DRAFTS = [draft(0, 'We export it every Friday.', 0), draft(1, 'By hand, yes.', 2000)];

const INPUT = { title: 'Acme — discovery call', occurredAt: '2026-09-01T15:00:00Z', segments: DRAFTS };

describe('writeTranscript', () => {
  it('writes the conversation, its segments and their embeddings', async () => {
    const { db, calls } = createFakeDb(DRAFTS);
    const embedder = fakeEmbedder();

    const result = await writeTranscript(A, INPUT, { db, embedder });

    expect(result).toEqual({
      conversationId: CONVERSATION_ID,
      segmentCount: 2,
      embeddedCount: 2,
    });
    expect(calls.map((c) => `${c.op} ${c.table}`)).toEqual([
      'insert conversations',
      'insert segments',
      'insert segment_embeddings',
    ]);
  });

  it('stamps every row with the companyId argument', async () => {
    const { db, calls } = createFakeDb(DRAFTS);

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() });

    for (const call of calls) {
      const rows = Array.isArray(call.payload) ? call.payload : [call.payload];
      for (const row of rows) {
        expect((row as { company_id: string }).company_id).toBe(A);
      }
    }
  });

  it('embeds each segment with its own text when rows come back out of order', async () => {
    // An insert makes no promise about the order of returned rows, and the
    // wrong pairing here would attach a vector to somebody else's words.
    const { db } = createFakeDb(DRAFTS, { segmentOrder: [1, 0] });
    const embed = vi.fn<(text: string) => Promise<number[]>>(
      async () => new Array<number>(768).fill(0.5),
    );

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder({ embed }) });

    expect(embed.mock.calls.map(([text]) => text)).toEqual([
      'By hand, yes.',
      'We export it every Friday.',
    ]);
  });

  it('records the embedding model on every vector', async () => {
    const { db, calls } = createFakeDb(DRAFTS);

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() });

    const embeddings = calls.find((c) => c.table === 'segment_embeddings')!.payload as {
      model: string;
    }[];
    expect(embeddings.every((row) => row.model === 'nomic-embed-text')).toBe(true);
  });

  it('deletes the conversation when writing segments fails', async () => {
    const { db, calls } = createFakeDb(DRAFTS, { failOn: 'segments' });

    await expect(writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() })).rejects.toThrow(
      /Writing segments failed/,
    );
    expect(calls.at(-1)).toMatchObject({ table: 'conversations', op: 'delete' });
  });

  it('deletes the conversation when embedding fails part-way', async () => {
    const { db, calls } = createFakeDb(DRAFTS);
    const embed = vi
      .fn<(text: string) => Promise<number[]>>()
      .mockResolvedValueOnce(new Array<number>(768).fill(0.5))
      .mockRejectedValueOnce(new Error('Ollama embed failed: 500'));

    await expect(
      writeTranscript(A, INPUT, { db, embedder: fakeEmbedder({ embed }) }),
    ).rejects.toThrow(/Ollama embed failed/);
    expect(calls.at(-1)).toMatchObject({ table: 'conversations', op: 'delete' });
  });

  it('deletes the conversation when storing embeddings fails', async () => {
    const { db, calls } = createFakeDb(DRAFTS, { failOn: 'embeddings' });

    await expect(writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() })).rejects.toThrow(
      /Storing segment embeddings failed/,
    );
    expect(calls.at(-1)).toMatchObject({ table: 'conversations', op: 'delete' });
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = createFakeDb(DRAFTS);

    await expect(
      writeTranscript('not-a-uuid' as never, INPUT, { db, embedder: fakeEmbedder() }),
    ).rejects.toThrow(TypeError);
  });

  it('refuses a transcript with no title or no segments', async () => {
    const { db } = createFakeDb(DRAFTS);
    const embedder = fakeEmbedder();

    await expect(
      writeTranscript(A, { ...INPUT, title: '  ' }, { db, embedder }),
    ).rejects.toThrow(/requires a title/);
    await expect(
      writeTranscript(A, { ...INPUT, segments: [] }, { db, embedder }),
    ).rejects.toThrow(/no segments/);
  });
});

describe('storeSegmentEmbeddings', () => {
  it('writes nothing and returns zero for an empty list', async () => {
    const { db, calls } = createFakeDb([]);

    expect(await storeSegmentEmbeddings(A, [], { db, model: 'nomic-embed-text' })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('rejects a vector of the wrong width before it reaches the database', async () => {
    const { db, calls } = createFakeDb([]);

    await expect(
      storeSegmentEmbeddings(A, [{ segmentId: 'seg-0', embedding: [1, 2, 3] }], {
        db,
        model: 'nomic-embed-text',
      }),
    ).rejects.toThrow(/768-dimension embedding/);
    expect(calls).toHaveLength(0);
  });

  it('requires the model that produced the vectors', async () => {
    const { db } = createFakeDb([]);

    await expect(
      storeSegmentEmbeddings(A, [{ segmentId: 'seg-0', embedding: new Array(768).fill(1) }], {
        db,
        model: '  ',
      }),
    ).rejects.toThrow(/requires the model name/);
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = createFakeDb([]);

    await expect(
      storeSegmentEmbeddings('nope' as never, [], { db, model: 'nomic-embed-text' }),
    ).rejects.toThrow(TypeError);
  });
});
