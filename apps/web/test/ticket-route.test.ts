/**
 * The bug this pins: clicking "Create ticket" twice opened two GitHub issues.
 *
 * `insight_tickets` has a unique (insight_id, provider), which stopped the
 * second ticket being *recorded* — but only after the route had already called
 * GitHub, so the duplicate existed in someone else's tracker and all the
 * constraint bought was a 500 describing it. Two tabs, a refresh, or a retry
 * after a timeout were enough.
 *
 * So: the existing ticket is looked up before GitHub is called, and the second
 * click is answered with the first click's ticket.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Table {
  rows: unknown[];
}

let tables: Record<string, Table>;
let rpcCalls: { name: string; args: unknown }[];
let issuesCreated: number;

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
  process.env['GITHUB_TOKEN'] = 'gh-test';
  process.env['GITHUB_TICKET_REPO'] = 'acme/tickets';
  rpcCalls = [];
  issuesCreated = 0;

  tables = {
    insights: { rows: [{ id: 'i1', title: 'Manual export', summary: 'It takes a Friday.', status: 'approved' }] },
    insight_tickets: { rows: [] },
    insight_evidence: { rows: [{ signal_id: 's1' }] },
    signals: { rows: [{ id: 's1', conversation_id: 'c1' }] },
    signal_evidence: { rows: [{ signal_id: 's1', segment_id: 'seg1', quote: 'we export by hand' }] },
    conversations: { rows: [{ id: 'c1', title: 'Acme discovery' }] },
    segments: { rows: [{ id: 'seg1', start_ms: 1000, speaker: 'customer' }] },
  };

  vi.stubGlobal('fetch', async () => {
    issuesCreated += 1;
    return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/acme/tickets/issues/7' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
});

describe('POST /api/insights/[id]/ticket', () => {
  it('creates the issue once and records it', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://github.com/acme/tickets/issues/7',
      number: 7,
    });
    expect(issuesCreated).toBe(1);
    expect(rpcCalls.map((call) => call.name)).toEqual(['record_insight_ticket']);
  });

  it('answers a second click with the first ticket, without calling GitHub', async () => {
    tables['insight_tickets'] = {
      rows: [{ url: 'https://github.com/acme/tickets/issues/7', external_id: '7' }],
    };

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://github.com/acme/tickets/issues/7',
      number: 7,
      alreadyRaised: true,
    });
    // The whole point: no second issue in anyone's tracker.
    expect(issuesCreated).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  it('refuses an insight nobody approved', async () => {
    tables['insights'] = { rows: [{ id: 'i1', title: 't', summary: 's', status: 'proposed' }] };

    const response = await post();

    expect(response.status).toBe(409);
    expect(issuesCreated).toBe(0);
  });

  it('refuses an insight with no evidence', async () => {
    tables['insight_evidence'] = { rows: [] };

    const response = await post();

    expect(response.status).toBe(409);
    expect(issuesCreated).toBe(0);
  });
});
