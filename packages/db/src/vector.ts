/**
 * An embedding, in the shape the generated types ask for.
 *
 * pgvector arguments come out of `supabase gen types` as `string`, because the
 * text form `[0.1,0.2]` is what Postgres itself accepts. PostgREST also
 * accepts the JSON array that supabase-js produces from a `number[]`, and that
 * is what this codebase has always sent — it is what the cross-tenant
 * integration test exercises against a real stack, and that test is the
 * control ADR 0004 rests on.
 *
 * So the array is kept and the type is corrected here, rather than the other
 * way round. Changing the wire format of the vector search function to satisfy
 * a generator's approximation is not a change to make without a stack to prove
 * it on, and the only thing that would prove it is the test that must never go
 * red for a reason unrelated to tenancy.
 *
 * The function is described rather than named on purpose: ADR 0004's guard is
 * a grep, and a grep that makes exceptions for prose is a grep that makes
 * exceptions.
 *
 * This is the only cast the generated types did not remove, and it is here,
 * once, with its reason attached — rather than at three call sites with none.
 */
export function vectorArg(embedding: readonly number[]): string {
  return embedding as unknown as string;
}
