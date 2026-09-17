import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it, vi } from 'vitest';
import { toCompanyId, writeSignals, type ResolvedSignal } from '../src/index';

const A = toCompanyId('00000000-0000-4000-8000-00000000000a');
const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000a1';

interface StoreArgs {
  p_company_id: string;
  p_conversation_id: string;
  p_detector: string;
  p_model: string;
  p_signals: {
    kind: string;
    summary: string;
    confidence: number;
    evidence: { segment_id: string; quote: string; quote_start: number; quote_end: number }[];
  }[];
}

function fakeDb(result: { data?: unknown; error?: { message: string } } = {}) {
  const data = result.error ? null : 'data' in result ? result.data : ['sig-1'];
  const rpc = vi.fn(async (_name: string, _args: StoreArgs) => ({
    data,
    error: result.error ?? null,
  }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

function signal(overrides: Partial<ResolvedSignal> = {}): ResolvedSignal {
  return {
    kind: 'problem',
    summary: 'The weekly export costs most of a Friday.',
    confidence: 0.86,
    evidence: [
      {
        segmentId: '00000000-0000-4000-8000-000000000a11',
        quote: 'takes us most of Friday afternoon',
        quoteStart: 28,
        quoteEnd: 61,
      },
    ],
    ...overrides,
  };
}

const INPUT = {
  conversationId: CONVERSATION_ID,
  detector: 't3-extract@2026-09-17',
  model: 'claude-opus-5',
  signals: [signal()],
};

describe('writeSignals', () => {
  it('writes every signal with its evidence in one call', async () => {
    const { db, rpc } = fakeDb();

    expect(await writeSignals(A, INPUT, { db })).toEqual(['sig-1']);
    expect(rpc).toHaveBeenCalledTimes(1);

    const [name, args] = rpc.mock.calls[0] as unknown as [string, StoreArgs];
    expect(name).toBe('store_signals');
    expect(args.p_company_id).toBe(A);
    expect(args.p_signals[0]?.evidence[0]).toEqual({
      segment_id: '00000000-0000-4000-8000-000000000a11',
      quote: 'takes us most of Friday afternoon',
      quote_start: 28,
      quote_end: 61,
    });
  });

  it('records which detector and model produced the signals', async () => {
    // Phase 3 measures precision per detector version; without this the
    // numbers cannot be attributed to anything.
    const { db, rpc } = fakeDb();

    await writeSignals(A, INPUT, { db });

    const args = (rpc.mock.calls[0] as unknown as [string, StoreArgs])[1];
    expect(args.p_detector).toBe('t3-extract@2026-09-17');
    expect(args.p_model).toBe('claude-opus-5');
  });

  it('treats an empty extraction as a result, not a failure', async () => {
    const { db, rpc } = fakeDb();

    expect(await writeSignals(A, { ...INPUT, signals: [] }, { db })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a signal with no evidence before the database has to', async () => {
    const { db, rpc } = fakeDb();

    await expect(
      writeSignals(A, { ...INPUT, signals: [signal({ evidence: [] })] }, { db }),
    ).rejects.toThrow(/no evidence/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a rejected quote from the database', async () => {
    const { db } = fakeDb({
      error: { message: 'signal_evidence: quote does not match segment' },
    });

    await expect(writeSignals(A, INPUT, { db })).rejects.toThrow(
      /store_signals failed: signal_evidence: quote does not match segment/,
    );
  });

  it('fails when fewer signals came back than were sent', async () => {
    const { db } = fakeDb({ data: [] });

    await expect(writeSignals(A, INPUT, { db })).rejects.toThrow(/Expected 1 signals/);
  });

  it('requires a detector and a model', async () => {
    const { db } = fakeDb();

    await expect(writeSignals(A, { ...INPUT, detector: ' ' }, { db })).rejects.toThrow(
      /requires the detector and model/,
    );
    await expect(writeSignals(A, { ...INPUT, model: '' }, { db })).rejects.toThrow(
      /requires the detector and model/,
    );
  });

  it('refuses a companyId that is not one', async () => {
    const { db, rpc } = fakeDb();

    await expect(writeSignals('nope' as never, INPUT, { db })).rejects.toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
