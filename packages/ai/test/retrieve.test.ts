/**
 * retrieve() without a database: argument guards, and the post-query tenant
 * check that is independent of the SQL filter.
 */
import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import {
  retrieve,
  TenantBoundaryViolation,
  toCompanyId,
  type CompanyId,
  type Embedder,
} from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');
const B = '00000000-0000-4000-8000-00000000000b';
const EMBEDDING = new Array<number>(768).fill(1);

function row(companyId: string) {
  return {
    segment_id: '00000000-0000-4000-8000-000000000a11',
    company_id: companyId,
    conversation_id: '00000000-0000-4000-8000-0000000000a1',
    speaker: 'customer',
    start_ms: 61000,
    end_ms: 68500,
    text: 'Exporting the weekly report takes us most of Friday afternoon.',
    similarity: 1,
  };
}

function fakeDb(rows: unknown[] = []) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('toCompanyId', () => {
  it('accepts a uuid', () => {
    expect(toCompanyId('00000000-0000-4000-8000-00000000000a')).toBe(A);
  });

  it.each(['', 'acme', '00000000-0000-4000-8000-00000000000', "' or 1=1 --"])(
    'rejects %j',
    (value) => {
      expect(() => toCompanyId(value)).toThrow(TypeError);
    },
  );
});

describe('retrieve', () => {
  it('passes the company id to match_segments', async () => {
    const { db, rpc } = fakeDb([row(A)]);
    await retrieve(A, { embedding: EMBEDDING }, { db, limit: 5, minSimilarity: 0.7 });
    expect(rpc).toHaveBeenCalledWith('match_segments', {
      p_company_id: A,
      p_query_embedding: EMBEDDING,
      p_match_count: 5,
      p_min_similarity: 0.7,
    });
  });

  it('maps rows to evidence with timestamps', async () => {
    const { db } = fakeDb([row(A)]);
    const [segment] = await retrieve(A, { embedding: EMBEDDING }, { db });
    expect(segment).toMatchObject({ companyId: A, startMs: 61000, endMs: 68500 });
  });

  it('throws, rather than filtering, when a foreign row comes back', async () => {
    const { db } = fakeDb([row(A), row(B)]);
    await expect(retrieve(A, { embedding: EMBEDDING }, { db })).rejects.toThrow(
      TenantBoundaryViolation,
    );
  });

  it.each([undefined, null, '', 'not-a-uuid'])(
    'refuses a missing or malformed company id (%j) before touching the database',
    async (bad) => {
      const { db, rpc } = fakeDb();
      await expect(
        retrieve(bad as unknown as CompanyId, { embedding: EMBEDDING }, { db }),
      ).rejects.toThrow(TypeError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('rejects an embedding of the wrong size', async () => {
    const { db, rpc } = fakeDb();
    await expect(retrieve(A, { embedding: [1, 2, 3] }, { db })).rejects.toThrow(/768/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([0, 101, 2.5])('rejects limit %j', async (limit) => {
    const { db } = fakeDb();
    await expect(retrieve(A, { embedding: EMBEDDING }, { db, limit })).rejects.toThrow(
      RangeError,
    );
  });

  it('embeds a text query with the supplied embedder', async () => {
    const { db, rpc } = fakeDb();
    const embedder: Embedder = { model: 'fake', embed: vi.fn(async () => EMBEDDING) };
    await retrieve(A, { text: 'weekly report export' }, { db, embedder });
    expect(embedder.embed).toHaveBeenCalledWith('weekly report export');
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('requires an embedder for a text query', async () => {
    const { db } = fakeDb();
    await expect(retrieve(A, { text: 'weekly report' }, { db })).rejects.toThrow(/embedder/);
  });

  it('surfaces database errors', async () => {
    const db = {
      rpc: async () => ({ data: null, error: { message: 'permission denied' } }),
    } as unknown as SupabaseClient;
    await expect(retrieve(A, { embedding: EMBEDDING }, { db })).rejects.toThrow(
      /permission denied/,
    );
  });
});
