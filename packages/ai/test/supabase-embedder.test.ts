/**
 * The embedder that talks to supabase/functions/embed.
 *
 * The worker embeds 16 texts in about 2.4 s and fails at 32 with
 * WORKER_RESOURCE_LIMIT — measured before this was written. So the thing worth
 * pinning is that no request ever carries more than 16, that the vectors come
 * back in the order the texts went out whatever order the requests finish in,
 * and that a short or malformed answer is an error rather than a silent
 * misalignment of vectors to segments.
 */
import { describe, expect, it } from 'vitest';
import {
  createSupabaseEmbedder,
  EMBED_BATCH,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from '../src/providers/embedder';

/** A vector whose first component says which text it came from. */
function vectorFor(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = Number(text.replace(/\D/g, ''));
  return v;
}

function fakeFunction(opts: { delayFor?: (batch: number) => number; short?: boolean } = {}) {
  const sizes: number[] = [];
  const auth: string[] = [];
  let call = 0;
  const fetch = (async (_url: URL, init: RequestInit) => {
    const index = call++;
    const { texts } = JSON.parse(String(init.body)) as { texts: string[] };
    sizes.push(texts.length);
    auth.push(String((init.headers as Record<string, string>)['authorization']));
    await new Promise((r) => setTimeout(r, opts.delayFor?.(index) ?? 0));
    const embeddings = texts.map(vectorFor);
    return new Response(JSON.stringify({ embeddings: opts.short ? embeddings.slice(1) : embeddings }), {
      status: 200,
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sizes, auth };
}

describe('createSupabaseEmbedder', () => {
  it('never sends more texts in one request than the worker can take', async () => {
    const fn = fakeFunction();
    const embedder = createSupabaseEmbedder({ url: 'https://x.supabase.co', token: 't', fetch: fn.fetch });

    await embedder.embedMany!(Array.from({ length: 40 }, (_, i) => `t${i}`));

    expect(Math.max(...fn.sizes)).toBeLessThanOrEqual(EMBED_BATCH);
    expect(fn.sizes.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('returns vectors in the order the texts were given, whatever order requests finish in', async () => {
    // The first batch is made the slowest. A vector paired with the wrong
    // segment is a search that returns the wrong words, confidently.
    const fn = fakeFunction({ delayFor: (batch) => (batch === 0 ? 30 : 0) });
    const embedder = createSupabaseEmbedder({
      url: 'https://x.supabase.co',
      token: 't',
      fetch: fn.fetch,
      concurrency: 3,
    });

    const texts = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const vectors = await embedder.embedMany!(texts);

    expect(vectors.map((v) => v[0])).toEqual(texts.map((_, i) => i));
  });

  it('refuses an answer with fewer vectors than texts', async () => {
    const fn = fakeFunction({ short: true });
    const embedder = createSupabaseEmbedder({ url: 'https://x.supabase.co', token: 't', fetch: fn.fetch });

    await expect(embedder.embedMany!(['t1', 't2'])).rejects.toThrow(/1 vectors for 2 texts/);
  });

  it('sends the caller token, and names the model it stands for', async () => {
    const fn = fakeFunction();
    const embedder = createSupabaseEmbedder({ url: 'https://x.supabase.co', token: 'user-jwt', fetch: fn.fetch });

    await embedder.embed('t1');

    expect(fn.auth[0]).toBe('Bearer user-jwt');
    expect(embedder.model).toBe(EMBEDDING_MODEL);
  });
});
