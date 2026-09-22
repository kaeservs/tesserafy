/**
 * Embedding segments that are already written.
 *
 * The property worth pinning is the same one write-transcript.test.ts pins
 * for imports: each vector must travel with the words it was made from. A
 * mis-paired vector is silent — it surfaces months later as bad retrieval,
 * never as an error — and the ordering hazard is worse here than on import,
 * because these embeddings are produced concurrently.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import {
  embedStoredSegments,
  pendingEmbeddings,
  toCompanyId,
  type Embedder,
  type PendingSegment,
} from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');

/** A vector that encodes its own text, so a mis-pairing is visible. */
function fingerprinting(): Embedder {
  return {
    model: 'fingerprint-test',
    embed: async (text: string) => {
      // Deliberately variable: a slow one must not overtake a fast one.
      await new Promise((resolve) => setTimeout(resolve, text.length % 7));
      const code = text.charCodeAt(0) / 1000;
      return Array.from({ length: 768 }, () => code);
    },
  };
}

function segment(id: string, text: string): PendingSegment {
  return { id, speaker: 'customer', startMs: 0, endMs: 1000, text };
}

interface EmbedArgs {
  p_company_id: string;
  p_model: string;
  p_rows: { segment_id: string; embedding: number[] }[];
}

function dbThatRecords(calls: EmbedArgs[], written?: (args: EmbedArgs) => number): SupabaseClient {
  return {
    rpc: async (name: string, args: EmbedArgs) => {
      expect(name).toBe('embed_stored_segments');
      calls.push(args);
      return { data: written ? written(args) : args.p_rows.length, error: null };
    },
  } as unknown as SupabaseClient;
}

describe('embedStoredSegments', () => {
  it('sends each vector with the segment whose words made it', async () => {
    const calls: EmbedArgs[] = [];
    const segments = [segment('s1', 'alpha'), segment('s2', 'bravo'), segment('s3', 'charlie')];

    await embedStoredSegments(A, segments, {
      db: dbThatRecords(calls),
      embedder: fingerprinting(),
    });

    const rows = calls[0]!.p_rows;
    for (const sent of rows) {
      const source = segments.find((s) => s.id === sent.segment_id)!;
      expect(sent.embedding[0]).toBeCloseTo(source.text.charCodeAt(0) / 1000, 6);
    }
  });

  it('never sends a company_id per row', async () => {
    // ADR 0008: the tenant comes from the argument and nowhere else, so a
    // caller cannot write a row against a company it names itself.
    const calls: EmbedArgs[] = [];

    await embedStoredSegments(A, [segment('s1', 'alpha')], {
      db: dbThatRecords(calls),
      embedder: fingerprinting(),
    });

    expect(calls[0]!.p_company_id).toBe(A);
    expect(Object.keys(calls[0]!.p_rows[0]!)).toEqual(['segment_id', 'embedding']);
  });

  it('batches, so a failure halfway leaves the earlier work done', async () => {
    const calls: EmbedArgs[] = [];
    const segments = Array.from({ length: 7 }, (_, i) => segment(`s${i}`, `text ${i}`));

    await embedStoredSegments(A, segments, {
      db: dbThatRecords(calls),
      embedder: fingerprinting(),
      batchSize: 3,
    });

    expect(calls.map((call) => call.p_rows.length)).toEqual([3, 3, 1]);
  });

  it('reports rows the database declined rather than swallowing them', async () => {
    // Only reachable when a caller builds the list some other way than
    // pendingEmbeddings(); a declined row means the segment is another
    // tenant's, which is exactly what the count should surface.
    const calls: EmbedArgs[] = [];
    const result = await embedStoredSegments(A, [segment('s1', 'a'), segment('s2', 'b')], {
      db: dbThatRecords(calls, () => 1),
      embedder: fingerprinting(),
    });

    expect(result).toEqual({ embedded: 1, skipped: 1 });
  });

  it('refuses a companyId that is not one', async () => {
    const db = { rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      embedStoredSegments('not-a-uuid' as never, [segment('s1', 'a')], {
        db,
        embedder: fingerprinting(),
      }),
    ).rejects.toThrow(TypeError);
  });

  it('does nothing, and calls nothing, for an empty list', async () => {
    const db = { rpc: vi.fn() } as unknown as SupabaseClient;

    const result = await embedStoredSegments(A, [], {
      db,
      embedder: fingerprinting(),
    });

    expect(result).toEqual({ embedded: 0, skipped: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('pendingEmbeddings', () => {
  it('asks the database which segments have no vector, scoped to the tenant', async () => {
    let seen: Record<string, unknown> = {};
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe('segments_without_embeddings');
        seen = args;
        return {
          data: [{ id: 's1', speaker: 'customer', start_ms: 100, end_ms: 900, text: 'hello' }],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const pending = await pendingEmbeddings(A, { db, conversationId: 'c1' });

    expect(seen).toEqual({ p_company_id: A, p_conversation_id: 'c1' });
    expect(pending).toEqual([
      { id: 's1', speaker: 'customer', startMs: 100, endMs: 900, text: 'hello' },
    ]);
  });
});
