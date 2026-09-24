/**
 * The embedding model, and the numbers that belong to it.
 *
 * gte-small, running inside Supabase (supabase/functions/embed), chosen by the
 * owner so that meeting text goes nowhere it is not already stored. It
 * replaced nomic-embed-text on an operator's machine, which the cloud app could
 * not reach.
 *
 * The similarity threshold lives here, beside the model, because it is a fact
 * about the model and not about the product. gte-small compresses similarity
 * into a narrow band — p10–p90 of 0.76–0.90 on production data, against
 * nomic's 0.37–0.71 — so the old threshold of 0.6 would have called every
 * signal related to every segment, silently.
 */
export const EMBEDDING_MODEL = 'gte-small';
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Cosine similarity at or above which two passages count as about the same
 * thing. Provisional, and calibrated on very little.
 *
 * Chosen by replaying clusterSignals() exactly — top 20 above the threshold,
 * same kind, at least 3 signals from 2 conversations — on the one company with
 * a real insight (20 signals, 8 calls). The old model at 0.6 formed one
 * cluster holding all 4 of that insight's signals. gte-small:
 *
 *   0.87  no clusters at all        0.84  the insight split in two
 *   0.82  the same 5-signal cluster, plus one false cluster of four unrelated
 *         feature requests grouped because each is phrased "They want..."
 *
 * 0.82 is the value that still finds the real insight. The false cluster it
 * adds is the price: gte-small groups by phrasing more than by subject.
 * Recall is preferred because insights are only proposed — a person approves
 * each one — so a false proposal costs a reviewer a minute, while a missed
 * finding is never seen at all.
 *
 * An earlier version chose 0.87 by maximising agreement over all
 * quote-to-segment pairs (96%). That was the wrong quantity: the handful of
 * cross-call links that form an insight are exactly the ones it lost. Re-run
 * the replay, not the pairwise measure, before moving this.
 */
export const RELATED_SIMILARITY = 0.82;

export interface Embedder {
  readonly model: string;
  embed(text: string): Promise<number[]>;
  /** Many at once, where the provider batches. Preferred when present. */
  embedMany?(texts: readonly string[]): Promise<number[][]>;
}

export interface SupabaseEmbedderOptions {
  /** The project URL. */
  readonly url: string;
  /**
   * A signed-in user's access token, or the service-role key for operator
   * scripts. The function refuses anything else, including the anonymous key.
   */
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Requests in flight at once. */
  readonly concurrency?: number;
}

/**
 * Texts per request. Measured, not chosen: the edge worker embeds 16 in about
 * 2.4 s and fails at 32 with WORKER_RESOURCE_LIMIT. The function enforces the
 * same number.
 */
export const EMBED_BATCH = 16;

export function createSupabaseEmbedder(options: SupabaseEmbedderOptions): Embedder {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = new URL('/functions/v1/embed', options.url);
  const concurrency = Math.max(1, options.concurrency ?? 3);

  async function request(texts: readonly string[]): Promise<number[][]> {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!response.ok) {
      throw new Error(`Supabase embed failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { embeddings?: unknown[] };
    const embeddings = body.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(`Supabase embed returned ${embeddings.length} vectors for ${texts.length} texts`);
    }
    for (const embedding of embeddings) assertEmbedding(embedding);
    return embeddings as number[][];
  }

  async function embedMany(texts: readonly string[]): Promise<number[][]> {
    const batches: (readonly string[])[] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      batches.push(texts.slice(start, start + EMBED_BATCH));
    }
    const results: number[][][] = new Array<number[][]>(batches.length);
    let next = 0;
    async function worker(): Promise<void> {
      while (next < batches.length) {
        const index = next++;
        results[index] = await request(batches[index]!);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));
    return results.flat();
  }

  return {
    model: EMBEDDING_MODEL,
    embedMany,
    async embed(text) {
      const [embedding] = await embedMany([text]);
      return embedding!;
    },
  };
}

export function assertEmbedding(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== EMBEDDING_DIMENSIONS ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    const length = Array.isArray(value) ? value.length : typeof value;
    throw new Error(`Expected a ${EMBEDDING_DIMENSIONS}-dimension embedding, got ${length}`);
  }
}
