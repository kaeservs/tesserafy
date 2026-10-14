import type { SupabaseClient } from '@tesserafy/db';
import { describe, expect, it } from 'vitest';
import { readCallTranscript } from '@/lib/call-transcript';

describe('readCallTranscript', () => {
  it('reads a call longer than the thousand rows one request returns', async () => {
    // PostgREST returns at most a thousand rows and says nothing; an import
    // may hold five thousand. Scoring and every T3 read used one request.
    const lines = Array.from({ length: 2_500 }, (_, i) => ({
      id: `s${i}`,
      speaker: 'customer',
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
      text: `line ${i}`,
    }));
    const orders: string[] = [];
    let filter: [string, string] | null = null;
    const query = {
      select: () => query,
      eq: (column: string, value: string) => {
        filter = [column, value];
        return query;
      },
      order: (column: string) => {
        orders.push(column);
        return query;
      },
      // The server's cap, not the page asked for.
      range: (from: number, to: number) =>
        Promise.resolve({ data: lines.slice(from, Math.min(to + 1, from + 1000)), error: null }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    const read = await readCallTranscript(db, 'call-1');

    expect(read).toHaveLength(2_500);
    expect(read.at(-1)?.text).toBe('line 2499');
    expect(filter).toEqual(['conversation_id', 'call-1']);
    // Paging needs an order with no ties: time, then id.
    expect(orders.slice(0, 2)).toEqual(['start_ms', 'id']);
  });
});
