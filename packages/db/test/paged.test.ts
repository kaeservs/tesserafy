import { describe, expect, it } from 'vitest';
import { batches, PAGE_SIZE, readAll } from '../src/queries/paged';

/** A table of n rows behind a server that caps every response at `cap`. */
function server(n: number, cap: number) {
  const table = Array.from({ length: n }, (_, i) => i);
  const asked: [number, number][] = [];
  const page = (from: number, to: number) => {
    asked.push([from, to]);
    return Promise.resolve({ data: table.slice(from, Math.min(to + 1, from + cap)), error: null });
  };
  return { page, asked };
}

describe('readAll', () => {
  it('returns every row, not the first page', async () => {
    const { page } = server(2500, PAGE_SIZE);
    const rows = await readAll(page, 'test');
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
  });

  it('is exact at a page boundary', async () => {
    // A result of exactly one full page is the case "stop on a short page"
    // gets right and "stop after one page" gets wrong; both must land on 1000.
    const { page } = server(PAGE_SIZE, PAGE_SIZE);
    expect(await readAll(page, 'test')).toHaveLength(PAGE_SIZE);
  });

  it('still reads everything if the server cap is lower than the page size', async () => {
    // A cap of 500 answers a request for 0–999 with 0–499. Moving on by the
    // page size would ask next for 1000 and lose 500–999 without a sound;
    // moving on by what arrived asks for 500.
    const { page, asked } = server(1200, 500);
    const rows = await readAll(page, 'test');
    expect(rows).toEqual(Array.from({ length: 1200 }, (_, i) => i));
    expect(asked.map(([from]) => from)).toEqual([0, 500, 1000, 1200]);
  });

  it('returns nothing for an empty table, after one request', async () => {
    const { page, asked } = server(0, PAGE_SIZE);
    expect(await readAll(page, 'test')).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('says what failed', async () => {
    const page = () => Promise.resolve({ data: null, error: { message: 'boom' } });
    await expect(readAll(page, 'Loading signals')).rejects.toThrow('Loading signals failed: boom');
  });
});

describe('batches', () => {
  it('splits a long list and keeps every item, in order', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const out = batches(ids, 100);
    expect(out.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(out.flat()).toEqual(ids);
  });

  it('gives no batches for no ids, so no request is made', () => {
    expect(batches([], 100)).toEqual([]);
  });
});
