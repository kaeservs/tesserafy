/**
 * P0 gate, "via retrieve()". Release-blocking — ADR 0004.
 *
 * Runs with the service-role key, so RLS is out of the path and only
 * retrieve() / match_segments stand between the tenants. The seed gives both
 * companies the same quote with the same embedding: without the tenant filter,
 * company B's copy would tie for first place.
 */
import { createServiceClient, vectorArg } from '@tesserafy/db';
import { requireIntegrationEnv, SEED, sharedQuoteEmbedding } from '@tesserafy/db/testing';
import { describe, expect, it } from 'vitest';
import { retrieve, toCompanyId } from '../src/index';

const env = requireIntegrationEnv();
const db = createServiceClient({ url: env.url, key: env.serviceRoleKey });

const companyA = toCompanyId(SEED.companyA.id);
const companyB = toCompanyId(SEED.companyB.id);

describe('retrieve() across tenants', () => {
  it('the fixture really overlaps: the service role can see both copies', async () => {
    // Guards the test itself. If the seed stopped overlapping, the isolation
    // assertions below would pass without proving anything.
    const { data, error } = await db
      .from('segment_embeddings')
      .select('company_id')
      .in('segment_id', [SEED.companyA.sharedQuoteSegmentId, SEED.companyB.sharedQuoteSegmentId]);
    expect(error).toBeNull();
    expect(new Set(data?.map((r) => r.company_id))).toEqual(
      new Set([SEED.companyA.id, SEED.companyB.id]),
    );
  });

  it('returns company A evidence to company A, and nothing of company B', async () => {
    const results = await retrieve(
      companyA,
      { embedding: sharedQuoteEmbedding() },
      { db, limit: 100, minSimilarity: 0 },
    );

    const ids = results.map((r) => r.segmentId);
    expect(ids).toContain(SEED.companyA.sharedQuoteSegmentId);
    expect(ids).not.toContain(SEED.companyB.sharedQuoteSegmentId);
    expect(ids).not.toContain(SEED.companyB.unrelatedSegmentId);
    expect(results.every((r) => r.companyId === companyA)).toBe(true);
  });

  it('is symmetric: company B never sees company A', async () => {
    const results = await retrieve(
      companyB,
      { embedding: sharedQuoteEmbedding() },
      { db, limit: 100, minSimilarity: 0 },
    );

    const ids = results.map((r) => r.segmentId);
    expect(ids).toContain(SEED.companyB.sharedQuoteSegmentId);
    expect(ids).not.toContain(SEED.companyA.sharedQuoteSegmentId);
    expect(ids).not.toContain(SEED.companyA.unrelatedSegmentId);
  });

  it('returns nothing for a company that does not exist', async () => {
    const results = await retrieve(
      toCompanyId('00000000-0000-4000-8000-0000000000ff'),
      { embedding: sharedQuoteEmbedding() },
      { db, limit: 100, minSimilarity: 0 },
    );
    expect(results).toEqual([]);
  });

  it('applies the similarity floor inside the tenant', async () => {
    const results = await retrieve(
      companyA,
      { embedding: sharedQuoteEmbedding() },
      { db, limit: 100, minSimilarity: 0.9 },
    );
    expect(results.map((r) => r.segmentId)).toEqual([SEED.companyA.sharedQuoteSegmentId]);
  });

  it('match_segments rejects a null company id at the database, too', async () => {
    const { error } = await db.rpc('match_segments', {
      // Deliberately the thing the type forbids. The point of this test is
      // that the database refuses it too: a type is a promise about the code
      // we wrote, and the tenancy boundary cannot rest on a promise that a
      // cast, a plain JavaScript caller or a hand-made request can break.
      p_company_id: null as unknown as string,
      p_query_embedding: vectorArg(sharedQuoteEmbedding()),
      p_match_count: 10,
      p_min_similarity: 0,
    });
    expect(error?.message).toMatch(/p_company_id is required/);
  });
});
