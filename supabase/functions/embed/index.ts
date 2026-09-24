/**
 * Text in, vectors out, with a model that runs inside Supabase.
 *
 * The owner chose Supabase's built-in embedding model over a hosted embedding
 * API so that meeting text goes nowhere it is not already stored. This
 * function is that choice: `gte-small` executes in Supabase's own edge
 * runtime, so embedding a segment adds no new company to the list of those
 * that see a customer's words.
 *
 * It computes and returns. It does not read or write the database and holds no
 * key of ours, deliberately — every write of a vector goes through an RPC that
 * checks the caller's membership, the same way every other write in this
 * product does. A function that embedded and stored in one step would need the
 * service role to do it.
 *
 * Who may call it: a signed-in user, or the service role (the operator
 * scripts). The gateway verifies the token's signature; the role is checked
 * here, because a publishable-key token is also a valid JWT and would
 * otherwise let an anonymous caller spend this project's compute.
 */

const MODEL = 'gte-small';
const DIMENSIONS = 384;

/**
 * Measured, not chosen: 16 texts embed in ~2.4 s, and 32 fail with
 * WORKER_RESOURCE_LIMIT — the worker runs out of compute, not time. Refusing
 * 17 with a clear 400 is better than crashing on 32 with a 546. Callers batch.
 */
const MAX_TEXTS = 16;
/** gte-small reads 512 tokens; past this, text is truncated anyway. */
const MAX_CHARS = 2_000;

// Created once per worker, not per request: loading the model is the slow part.
const session = new Supabase.ai.Session(MODEL);

function roleOf(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'POST only' });

  const role = roleOf(request.headers.get('authorization'));
  if (role !== 'authenticated' && role !== 'service_role') {
    return reply(401, { error: 'sign in to embed text' });
  }

  let texts: unknown;
  try {
    ({ texts } = await request.json());
  } catch {
    return reply(400, { error: 'body must be JSON: { "texts": string[] }' });
  }

  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS) {
    return reply(400, { error: `texts must be an array of 1 to ${MAX_TEXTS} strings` });
  }
  if (!texts.every((text) => typeof text === 'string' && text.trim().length > 0)) {
    return reply(400, { error: 'every text must be a non-empty string' });
  }

  const embeddings: number[][] = [];
  for (const text of texts as string[]) {
    // mean_pool and normalize, so a dot product is a cosine similarity — which
    // is what the vector search compares.
    const vector = (await session.run(text.slice(0, MAX_CHARS), {
      mean_pool: true,
      normalize: true,
    })) as number[];
    embeddings.push(Array.from(vector));
  }

  return reply(200, { model: MODEL, dimensions: DIMENSIONS, embeddings });
});
