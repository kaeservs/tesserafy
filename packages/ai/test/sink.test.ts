import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import { awaitableDatabaseSink, both, databaseSink, logUsage, type UsageEvent } from '../src/index';

const EVENT: UsageEvent = {
  tier: 't3',
  model: 'claude-opus-5',
  inputTokens: 1200,
  outputTokens: 300,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 800,
  durationMs: 5500,
};

function fakeDb(error?: { message: string }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: 'usage-1',
    error: error ?? null,
  }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('databaseSink', () => {
  it('records the call with its tier, model and tokens', async () => {
    const { db, rpc } = fakeDb();

    databaseSink({ db })(EVENT);
    await flush();

    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('record_model_usage');
    expect(args).toMatchObject({
      p_tier: 't3',
      p_model: 'claude-opus-5',
      p_input_tokens: 1200,
      p_output_tokens: 300,
      p_cache_read_tokens: 800,
      p_duration_ms: 5500,
    });
  });

  it('attributes the call when the caller knows who it was for', async () => {
    const { db, rpc } = fakeDb();

    databaseSink({
      db,
      companyId: '00000000-0000-4000-8000-00000000000a',
      conversationId: 'c1',
      detector: 't3-extract@2026-09-19',
    })(EVENT);
    await flush();

    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args['p_company_id']).toBe('00000000-0000-4000-8000-00000000000a');
    expect(args['p_conversation_id']).toBe('c1');
    expect(args['p_detector']).toBe('t3-extract@2026-09-19');
  });

  it('records a call it cannot attribute to anyone', async () => {
    // A T1 detection has no company: the window comes from the caller and the
    // endpoint holds no database credentials. That row is still worth keeping,
    // and it is most of the live cost.
    //
    // What goes on the wire is absence, not null. The arguments have
    // `default null` in SQL, so an omitted one stores exactly the same row,
    // and absence is what the generated types describe. The row is the
    // contract here; the spelling is not.
    const { db, rpc } = fakeDb();

    databaseSink({ db })(EVENT);
    await flush();

    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args['p_tier']).toBe(EVENT.tier);
    expect('p_company_id' in args).toBe(false);
    expect('p_detector' in args).toBe(false);
  });

  it('attributes a call when it can', async () => {
    const { db, rpc } = fakeDb();

    databaseSink({ db, companyId: 'c-1', detector: 't1-detect@2026-09-19' })(EVENT);
    await flush();

    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args['p_company_id']).toBe('c-1');
    expect(args['p_detector']).toBe('t1-detect@2026-09-19');
  });

  it('never throws when recording fails', async () => {
    // Failing an extraction because its telemetry failed would be absurd.
    const { db } = fakeDb({ message: 'permission denied' });
    const errors: Error[] = [];

    expect(() => databaseSink({ db, onError: (e) => errors.push(e) })(EVENT)).not.toThrow();
    await flush();

    expect(errors[0]?.message).toContain('permission denied');
  });

  it('survives a database that rejects outright', async () => {
    const db = {
      rpc: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as unknown as SupabaseClient;
    const errors: Error[] = [];

    databaseSink({ db, onError: (e) => errors.push(e) })(EVENT);
    await flush();

    expect(errors[0]?.message).toBe('connection refused');
  });
});

describe('both', () => {
  it('sends the same event to every sink', () => {
    const seen: string[] = [];

    both(
      () => seen.push('first'),
      () => seen.push('second'),
    )(EVENT);

    expect(seen).toEqual(['first', 'second']);
  });

  it('pairs the console line with the stored row', async () => {
    const { db, rpc } = fakeDb();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    both(logUsage, databaseSink({ db }))(EVENT);
    await flush();

    expect(info).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
    info.mockRestore();
  });
});

describe('awaitableDatabaseSink', () => {
  it('lets a serverless caller wait until the row is written', async () => {
    // The row a T3 run writes is also what marks the call as read. Returning
    // before it lands, in a function that freezes after responding, is how a
    // run that found nothing would forget it ever ran.
    let written = false;
    const db = {
      rpc: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            written = true;
            resolve({ error: null });
          }, 20);
        }),
    } as never;

    const usage = awaitableDatabaseSink({ db });
    usage.sink(EVENT);
    expect(written).toBe(false);

    await usage.settled();
    expect(written).toBe(true);
  });

  it('still never throws when the write fails', async () => {
    const errors: Error[] = [];
    const { db } = fakeDb({ message: 'permission denied' });

    const usage = awaitableDatabaseSink({ db, onError: (e) => errors.push(e) });
    usage.sink(EVENT);

    await expect(usage.settled()).resolves.toBeUndefined();
    expect(errors[0]?.message).toContain('permission denied');
  });
});
