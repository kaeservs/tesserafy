/**
 * The writer without a database. Ingest is one RPC — `ingest_transcript`, a
 * single transaction — so these tests assert what would have been sent, and
 * above all that each vector travels with the words it was made from.
 */
import { EMBEDDING_DIMENSIONS } from '../src/providers/embedder';
import type { SupabaseClient } from '@tesserafy/db';
import type { SegmentDraft } from '@tesserafy/ingest';
import { describe, expect, it, vi } from 'vitest';
import {
  conversationForSource,
  DuplicateSource,
  storeTranscript,
  toCompanyId,
  writeTranscript,
  type Embedder,
} from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');
const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000a1';

interface IngestArgs {
  p_company_id: string;
  p_title: string;
  p_occurred_at: string | null;
  p_model: string;
  p_source_key: string | null;
  p_segments: {
    id: string;
    speaker: string | null;
    start_ms: number;
    end_ms: number;
    text: string;
    embedding: number[];
  }[];
}

function fakeDb(result: { data?: unknown; error?: { message: string; code?: string } } = {}) {
  // `data` is honoured when present even if it is null — that is the case a
  // test wants to pin.
  const data = result.error ? null : 'data' in result ? result.data : CONVERSATION_ID;
  const rpc = vi.fn(async () => ({ data, error: result.error ?? null }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

function embedding(fill: number): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);
}

function fakeEmbedder(overrides: Partial<Embedder> = {}): Embedder {
  return {
    model: 'gte-small',
    embed: vi.fn<(text: string) => Promise<number[]>>(async () => embedding(0.5)),
    ...overrides,
  };
}

function draft(index: number, text: string, startMs: number): SegmentDraft {
  return { index, speaker: 'customer', startMs, endMs: startMs + 1000, text };
}

const DRAFTS = [draft(0, 'We export it every Friday.', 0), draft(1, 'By hand, yes.', 2000)];

const INPUT = {
  title: 'Acme — discovery call',
  occurredAt: '2026-09-01T15:00:00Z',
  segments: DRAFTS,
};

function argsOf(rpc: ReturnType<typeof fakeDb>['rpc']): IngestArgs {
  return (rpc.mock.calls[0] as unknown as [string, IngestArgs])[1];
}

describe('writeTranscript', () => {
  it('writes the whole transcript in a single call', async () => {
    const { db, rpc } = fakeDb();

    const result = await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() });

    expect(result).toEqual({ conversationId: CONVERSATION_ID, segmentCount: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect((rpc.mock.calls[0] as unknown as [string])[0]).toBe('ingest_transcript');
  });

  it('sends the tenant from the companyId argument', async () => {
    const { db, rpc } = fakeDb();

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() });

    expect(argsOf(rpc).p_company_id).toBe(A);
  });

  it('pairs every vector with its own words', async () => {
    // The failure this guards against is silent: a vector attached to another
    // segment's words shows up only as bad retrieval, months later.
    const embed = vi.fn<(text: string) => Promise<number[]>>(async (text) =>
      embedding(text.length),
    );
    const { db, rpc } = fakeDb();

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder({ embed }) });

    for (const segment of argsOf(rpc).p_segments) {
      expect(segment.embedding[0]).toBe(segment.text.length);
    }
  });

  it('mints a distinct id for every segment', async () => {
    const { db, rpc } = fakeDb();

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() });

    const ids = argsOf(rpc).p_segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('carries speaker, timings and text through unchanged', async () => {
    const { db, rpc } = fakeDb();

    await writeTranscript(A, INPUT, { db, embedder: fakeEmbedder(), newId: () => 'fixed-id' });

    expect(argsOf(rpc).p_segments[1]).toMatchObject({
      id: 'fixed-id',
      speaker: 'customer',
      start_ms: 2000,
      end_ms: 3000,
      text: 'By hand, yes.',
    });
    expect(argsOf(rpc).p_title).toBe('Acme — discovery call');
    expect(argsOf(rpc).p_occurred_at).toBe('2026-09-01T15:00:00Z');
    expect(argsOf(rpc).p_model).toBe('gte-small');
  });

  it('writes nothing when embedding fails', async () => {
    const embed = vi
      .fn<(text: string) => Promise<number[]>>()
      .mockResolvedValueOnce(embedding(0.5))
      .mockRejectedValueOnce(new Error('Ollama embed failed: 500'));
    const { db, rpc } = fakeDb();

    await expect(
      writeTranscript(A, INPUT, { db, embedder: fakeEmbedder({ embed }) }),
    ).rejects.toThrow(/Ollama embed failed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a failed ingest without any cleanup of its own', async () => {
    const { db, rpc } = fakeDb({ error: { message: 'duplicate key value' } });

    await expect(writeTranscript(A, INPUT, { db, embedder: fakeEmbedder() })).rejects.toThrow(
      /ingest_transcript failed: duplicate key value/,
    );
    // The transaction rolled back in Postgres; there is nothing to undo here.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses a companyId that is not one', async () => {
    const { db, rpc } = fakeDb();

    await expect(
      writeTranscript('not-a-uuid' as never, INPUT, { db, embedder: fakeEmbedder() }),
    ).rejects.toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a transcript with no segments before embedding anything', async () => {
    const { db, rpc } = fakeDb();
    const embedder = fakeEmbedder();

    await expect(
      writeTranscript(A, { ...INPUT, segments: [] }, { db, embedder }),
    ).rejects.toThrow(/no segments/);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('storeTranscript', () => {
  const segment = {
    id: '00000000-0000-4000-8000-000000000a11',
    speaker: 'customer',
    startMs: 0,
    endMs: 1000,
    text: 'We export it every Friday.',
    embedding: embedding(1),
  };
  const input = { title: 'Acme', occurredAt: null, model: 'gte-small', segments: [segment] };

  it('returns the conversation id the function produced', async () => {
    const { db } = fakeDb();

    expect(await storeTranscript(A, input, { db })).toBe(CONVERSATION_ID);
  });

  it('rejects a vector of the wrong width before it reaches the database', async () => {
    const { db, rpc } = fakeDb();

    await expect(
      storeTranscript(A, { ...input, segments: [{ ...segment, embedding: [1, 2, 3] }] }, { db }),
    ).rejects.toThrow(`${EMBEDDING_DIMENSIONS}-dimension embedding`);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a title, a model and at least one segment', async () => {
    const { db } = fakeDb();

    await expect(storeTranscript(A, { ...input, title: ' ' }, { db })).rejects.toThrow(
      /requires a title/,
    );
    await expect(storeTranscript(A, { ...input, model: ' ' }, { db })).rejects.toThrow(
      /requires the model name/,
    );
    await expect(storeTranscript(A, { ...input, segments: [] }, { db })).rejects.toThrow(
      /no segments/,
    );
  });

  it('fails loudly when the function returns no id', async () => {
    const { db } = fakeDb({ data: null });

    await expect(storeTranscript(A, input, { db })).rejects.toThrow(/returned no conversation id/);
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = fakeDb();

    await expect(storeTranscript('nope' as never, input, { db })).rejects.toThrow(TypeError);
  });

  it('passes the source key through, and imports without one', async () => {
    // A transcript that came from a file has a source key, which is what makes
    // a re-import detectable. One typed in by hand has none, and must still
    // import: the argument is left out, the function's own default stands, and
    // the row is identical to the one an explicit null produced.
    const { db, rpc } = fakeDb();

    await storeTranscript(A, { ...input, sourceKey: 'calls/acme.vtt' }, { db });
    await storeTranscript(A, input, { db });

    const args = rpc.mock.calls.map((call) => (call as unknown as [string, IngestArgs])[1]);
    expect(args[0]?.p_source_key).toBe('calls/acme.vtt');
    expect(args[1] && 'p_source_key' in args[1]).toBe(false);
  });

  it('reports a re-import as a duplicate, not a failure', async () => {
    // A batch run treats this as "skip"; anything else would fail a whole
    // import because one file was already there.
    const { db } = fakeDb({ error: { message: 'duplicate key value', code: '23505' } });

    await expect(
      storeTranscript(A, { ...input, sourceKey: 'calls/acme.vtt' }, { db }),
    ).rejects.toThrow(DuplicateSource);
  });
});

describe('conversationForSource', () => {
  it('returns the conversation a previous import created', async () => {
    const { db } = fakeDb({ data: CONVERSATION_ID });

    expect(await conversationForSource(A, 'calls/acme.vtt', { db })).toBe(CONVERSATION_ID);
  });

  it('returns null when the source has never been imported', async () => {
    const { db } = fakeDb({ data: null });

    expect(await conversationForSource(A, 'calls/new.vtt', { db })).toBeNull();
  });

  it('refuses a companyId that is not one', async () => {
    const { db } = fakeDb();

    await expect(conversationForSource('nope' as never, 'k', { db })).rejects.toThrow(TypeError);
  });
});
