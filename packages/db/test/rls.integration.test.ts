/**
 * P0 gate, "via API": a signed-in member of company A, using the publishable
 * key exactly as the browser would, cannot read company B's data.
 *
 * Release-blocking. See ADR 0004.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient, createUserClient, vectorArg, type SupabaseClient } from '../src/index';
import { requireIntegrationEnv, SEED, sharedQuoteEmbedding } from '../src/testing';

const env = requireIntegrationEnv();
const admin = createServiceClient({ url: env.url, key: env.serviceRoleKey });

const createdUserIds: string[] = [];
let userA: SupabaseClient;

async function memberOf(companyId: string): Promise<SupabaseClient> {
  const email = `rls-${randomUUID()}@test.tesserafy.local`;
  const password = randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  createdUserIds.push(created.user.id);

  const { error: memberError } = await admin
    .from('company_members')
    .insert({ company_id: companyId, user_id: created.user.id });
  if (memberError) throw memberError;

  const client = createUserClient({ url: env.url, key: env.anonKey });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

beforeAll(async () => {
  userA = await memberOf(SEED.companyA.id);
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe('RLS: member of company A', () => {
  it('sees only company A', async () => {
    const { data, error } = await userA.from('companies').select('id');
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([SEED.companyA.id]);
  });

  it('sees only company A conversations', async () => {
    const { data, error } = await userA.from('conversations').select('id, company_id');
    expect(error).toBeNull();
    expect(data).not.toHaveLength(0);
    expect(data?.every((row) => row.company_id === SEED.companyA.id)).toBe(true);
  });

  it('sees only company A segments', async () => {
    const { data, error } = await userA.from('segments').select('id, company_id');
    expect(error).toBeNull();
    expect(data).not.toHaveLength(0);
    expect(data?.every((row) => row.company_id === SEED.companyA.id)).toBe(true);
  });

  it('gets nothing when asking for a company B row by id', async () => {
    const { data, error } = await userA
      .from('segments')
      .select('id')
      .eq('id', SEED.companyB.sharedQuoteSegmentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('cannot read company B memberships', async () => {
    const { data, error } = await userA
      .from('company_members')
      .select('company_id')
      .eq('company_id', SEED.companyB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('cannot read embeddings at all, even its own company', async () => {
    const { data, error } = await userA.from('segment_embeddings').select('segment_id');
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it('cannot call match_segments, even for its own company', async () => {
    const { data, error } = await userA.rpc('match_segments', {
      p_company_id: SEED.companyA.id,
      p_query_embedding: vectorArg(sharedQuoteEmbedding()),
      p_match_count: 10,
      p_min_similarity: 0,
    });
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it('cannot write into company B', async () => {
    const { error } = await userA
      .from('conversations')
      .insert({ company_id: SEED.companyB.id, title: 'planted' });
    expect(error).not.toBeNull();
  });
});

describe('RLS: anonymous client', () => {
  it('sees no tenant data', async () => {
    const anon = createUserClient({ url: env.url, key: env.anonKey });
    for (const table of ['companies', 'conversations', 'segments'] as const) {
      const { data } = await anon.from(table).select('id');
      expect(data ?? [], table).toEqual([]);
    }
  });
});
