# 0011 — Retrieval under the user's session

**Status:** proposed · 2026-09-24 · supersedes the service-role-only part of 0004

## Context

ADR 0004 put every vector query behind one function, `retrieve(companyId, …)`,
because the AI pipeline ran with a service-role key and a service-role key
bypasses Row Level Security. In that world `retrieve()` was the only control
between tenants, and `match_segments` was granted to the service role alone.

0004 named the alternative and set it aside: *"Run the AI pipeline under the
user's JWT so RLS applies. Genuinely appealing, and worth revisiting."* It was
rejected because background jobs have no user session.

A customer pressing "Find insights across my calls" does have one. The owner
decided that customers should be able to ask for cross-call insights
themselves, and that the web app — which may never hold the service-role key
(invariant 3) — should do it as them.

## Decision

`match_segments` becomes `SECURITY DEFINER` and callable by a signed-in user,
with one added rule inside the database: **when there is a signed-in caller,
they must be a member of `p_company_id`, or the function raises.** When there
is no caller — the service role, from operator scripts — it behaves exactly as
before.

`store_insight` stays service-role-only. A new `record_insight` does the same
job for a signed-in member: membership-checked, company taken from the
argument and verified, and every cited signal must already belong to that
company — which the composite foreign key on `insight_evidence` enforces as
well.

Everything else in 0004 stands:

- `retrieve()` is still the only code that may construct a vector query, and
  its `companyId` is still required and positional. The web app calls
  `retrieve()`; it does not call `match_segments`.
- The grep guard is unchanged in strictness, and now also names the vector
  *write* functions, which it had been missing (see Consequences).
- The cross-tenant test stays release-blocking, and gains a case: a member of
  one company searching another is refused by the database.

## Consequences

The tenant check now exists twice for the customer path: in the database,
against the caller's own membership, and in `retrieve()`, which throws on any
row from a company it did not ask for. For the service-role path it is still
once, in `retrieve()` — that path is unchanged, and 0004's reasoning about it
still holds.

The vector table stays unreadable directly. A member can search it only
through `match_segments`, for their own company, and only via `retrieve()` in
code; `select` on `segment_embeddings` still returns nothing to anyone but the
service role.

While writing this, `apps/web/lib/embed-upload.ts` (from the previous change)
was found writing vectors from outside the retrieval module, contrary to ADR
0008. The write was tenant-safe — the database takes the company from the
conversation — but it was in the wrong place, and the guard missed it because
it matched `segment_embeddings` as a whole word and the function is called
`record_segment_embeddings`. The write moves into `packages/ai/src/retrieval`,
and the guard now names `record_segment_embeddings` and
`embed_stored_segments` explicitly.

## Alternatives considered

- **Queue the request for a worker holding the service key.** Keeps 0004
  untouched, at the cost of latency and one more thing that can stall quietly.
- **A Supabase Edge Function with the service key.** No new server, but it
  puts the service key and the Anthropic key in a second runtime, which is
  what invariant 3 exists to prevent.
- **An RLS select policy on `segment_embeddings` for members.** Simpler, and
  wrong: it would make the vector table directly readable, which 0004 and the
  existing RLS test both deliberately forbid.
