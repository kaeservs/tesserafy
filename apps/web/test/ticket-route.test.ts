/**
 * Two bugs this pins.
 *
 * Clicking "Create ticket" twice opened two GitHub issues. `insight_tickets`
 * has a unique (insight_id, provider), which stopped the second ticket being
 * *recorded* — but only after the route had already called GitHub, so the
 * duplicate existed in someone else's tracker. So the existing ticket is looked
 * up before GitHub is called, and the second click gets the first's ticket.
 *
 * And every company's tickets went to one repository in this app's
 * environment. Now they go to the company's own tracker, with its own token,
 * opened here from its sealed form (ADR 0015).
 */
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sealToken } from '@/lib/tracker-secret';

interface Table {
  rows: unknown[];
}

const COMPANY = '00000000-0000-4000-8000-00000000000a';

let tables: Record<string, Table>;
let rpcCalls: { name: string; args: unknown }[];
let issues: { url: string; auth: string }[];
let tracker: { provider: string; target: string; token_ciphertext: string; company_id: string } | null;

/**
 * Enough of PostgREST's builder to run this route: chainable, awaitable, and
 * indifferent to which filters were applied — the route's correctness here is
 * about the order it does things in, not about the filtering, which the
 * database tests already cover.
 */
function builder(table: string) {
  const rows = () => tables[table]?.rows ?? [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows(), error: null }),
  };
  return chain;
}

const db = {
  from: (table: string) => builder(table),
  rpc: async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    if (name === 'tracker_for_ticket') return { data: tracker ? [tracker] : [], error: null };
    return { data: null, error: null };
  },
};

vi.mock('@/lib/supabase/caller', () => ({
  caller: async () => ({ db, userId: 'u1' }),
}));

const { POST } = await import('@/app/api/insights/[id]/ticket/route');

function post(id = 'i1') {
  return POST(new NextRequest('https://app.example.com/api/insights/i1/ticket', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  process.env['TRACKER_TOKEN_KEY'] = randomBytes(32).toString('base64');
  rpcCalls = [];
  issues = [];
  tracker = {
    provider: 'github',
    target: 'acme/product',
    token_ciphertext: sealToken('acme-own-token', COMPANY),
    company_id: COMPANY,
  };

  tables = {
    insights: { rows: [{ id: 'i1', title: 'Manual export', summary: 'It takes a Friday.', status: 'approved' }] },
    insight_tickets: { rows: [] },
    insight_evidence: { rows: [{ signal_id: 's1' }] },
    signals: { rows: [{ id: 's1', conversation_id: 'c1' }] },
    signal_evidence: { rows: [{ signal_id: 's1', segment_id: 'seg1', quote: 'we export by hand' }] },
    conversations: { rows: [{ id: 'c1', title: 'Acme discovery' }] },
    segments: { rows: [{ id: 'seg1', start_ms: 1000, speaker: 'customer' }] },
  };

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    issues.push({ url, auth: (init.headers as Record<string, string>)['authorization'] ?? '' });
    return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/acme/product/issues/7' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
});

describe('POST /api/insights/[id]/ticket', () => {
  it('creates the issue once, in the company\'s own repository with its own token, and records it', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://github.com/acme/product/issues/7',
      key: '7',
    });
    expect(issues).toEqual([
      { url: 'https://api.github.com/repos/acme/product/issues', auth: 'Bearer acme-own-token' },
    ]);
    expect(rpcCalls.map((call) => call.name)).toEqual(['tracker_for_ticket', 'record_insight_ticket']);
  });

  it('raises it in Jira Cloud when that is where the company’s tickets go', async () => {
    tracker = {
      provider: 'jira',
      target: 'acme.atlassian.net/PROD',
      token_ciphertext: sealToken(JSON.stringify({ email: 'pm@acme.test', token: 'jira-api-token' }), COMPANY),
      company_id: COMPANY,
    };
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      issues.push({ url, auth: (init.headers as Record<string, string>)['authorization'] ?? '' });
      if (url.endsWith('/issuetypes')) {
        return Response.json({ issueTypes: [{ name: 'Sub-task', subtask: true }, { name: 'Story' }, { name: 'Task' }] });
      }
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ key: 'PROD-42' }, { status: 201 });
    });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: 'https://acme.atlassian.net/browse/PROD-42', key: 'PROD-42' });
    const basic = `Basic ${Buffer.from('pm@acme.test:jira-api-token').toString('base64')}`;
    expect(issues).toEqual([
      { url: 'https://acme.atlassian.net/rest/api/2/issue/createmeta/PROD/issuetypes', auth: basic },
      { url: 'https://acme.atlassian.net/rest/api/2/issue', auth: basic },
    ]);
    const fields = (bodies[0] as { fields: { issuetype: { name: string }; description: string; project: { key: string } } }).fields;
    expect(fields.project.key).toBe('PROD');
    expect(fields.issuetype.name).toBe('Task');
    // Wiki markup, not markdown: Jira would show the markdown's brackets literally.
    expect(fields.description).toContain('h2. Evidence');
    expect(fields.description).toMatch(/\[transcript\|https:\/\/app\.example\.com\/conversations\/c1#segment-seg1\]/);
    expect(rpcCalls.at(-1)).toEqual({
      name: 'record_insight_ticket',
      args: { p_insight_id: 'i1', p_provider: 'jira', p_external_id: 'PROD-42', p_url: 'https://acme.atlassian.net/browse/PROD-42' },
    });
  });

  it('raises it in Linear, in the team the company named', async () => {
    tracker = { provider: 'linear', target: 'ENG', token_ciphertext: sealToken('lin_api_key_0123456789', COMPANY), company_id: COMPANY };
    const queries: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      issues.push({ url, auth: (init.headers as Record<string, string>)['authorization'] ?? '' });
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      queries.push(body.query.split('(')[0]!.trim());
      if (body.query.startsWith('query')) return Response.json({ data: { teams: { nodes: [{ id: 'team-1', name: 'Engineering' }] } } });
      expect(body.variables['input']).toMatchObject({ teamId: 'team-1', title: 'Manual export' });
      return Response.json({ data: { issueCreate: { success: true, issue: { identifier: 'ENG-7', url: 'https://linear.app/acme/issue/ENG-7' } } } });
    });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: 'https://linear.app/acme/issue/ENG-7', key: 'ENG-7' });
    expect(issues.map((call) => call)).toEqual([
      { url: 'https://api.linear.app/graphql', auth: 'lin_api_key_0123456789' },
      { url: 'https://api.linear.app/graphql', auth: 'lin_api_key_0123456789' },
    ]);
    expect(queries).toEqual(['query Team', 'mutation Create']);
  });

  it('answers a second click with the first ticket, without calling GitHub', async () => {
    tables['insight_tickets'] = {
      rows: [{ url: 'https://github.com/acme/product/issues/7', external_id: '7' }],
    };

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://github.com/acme/product/issues/7',
      key: '7',
      alreadyRaised: true,
    });
    // The whole point: no second issue in anyone's tracker.
    expect(issues).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it('refuses an insight nobody approved', async () => {
    tables['insights'] = { rows: [{ id: 'i1', title: 't', summary: 's', status: 'proposed' }] };

    const response = await post();

    expect(response.status).toBe(409);
    expect(issues).toEqual([]);
  });

  it('refuses an insight with no evidence', async () => {
    tables['insight_evidence'] = { rows: [] };

    const response = await post();

    expect(response.status).toBe(409);
    expect(issues).toEqual([]);
  });

  it('says where to connect a tracker when the company has none, and calls nobody', async () => {
    tracker = null;

    const response = await post();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Where tickets go') });
    expect(issues).toEqual([]);
  });

  it('will not use a token sealed for another company', async () => {
    tracker = { ...tracker!, token_ciphertext: sealToken('globex-token', '00000000-0000-4000-8000-00000000000b') };

    const response = await post();

    expect(response.status).toBe(409);
    expect(issues).toEqual([]);
  });

  it('says so when the deployment cannot open tokens at all', async () => {
    delete process.env['TRACKER_TOKEN_KEY'];

    const response = await post();

    expect(response.status).toBe(503);
    expect(issues).toEqual([]);
  });
});
