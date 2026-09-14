export const EMBEDDING_DIMENSIONS = 768;

export interface Embedder {
  readonly model: string;
  embed(text: string): Promise<number[]>;
}

export interface OllamaEmbedderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

/** nomic-embed-text through a local Ollama server. */
export function createOllamaEmbedder(options: OllamaEmbedderOptions): Embedder {
  const doFetch = options.fetch ?? globalThis.fetch;
  const endpoint = new URL('/api/embed', options.baseUrl);

  return {
    model: options.model,
    async embed(text) {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: text }),
      });
      if (!response.ok) {
        throw new Error(`Ollama embed failed: ${response.status} ${await response.text()}`);
      }
      const body = (await response.json()) as { embeddings?: number[][] };
      const embedding = body.embeddings?.[0];
      assertEmbedding(embedding);
      return embedding;
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
