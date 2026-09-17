# 0008 — The retrieval module owns writes to the vector table

**Status:** proposed · 2026-09-17

## Context

ADR 0004 put every vector *read* behind `retrieve(companyId, …)` in
`packages/ai/src/retrieval`, and `scripts/check-retrieval-guard.mjs` enforces
it by grep: the strings `match_segments` and `segment_embeddings` may not
appear anywhere else.

Phase 1 needs to write embeddings, which the guard forbids everywhere the
writer might sensibly live. The guard was not wrong to forbid it. It simply
had not been asked the question yet, because until now nothing wrote vectors
outside the seed fixture.

A wrong `company_id` on a write is worse than a wrong tenant filter on a read.
A bad read returns the wrong rows for as long as the bug is deployed, and
stops when it is fixed. A bad write leaves a row that belongs to the wrong
tenant permanently, and it will be returned by every later search, including
correctly filtered ones — the leak outlives the bug that caused it.

## Decision

The retrieval module owns the vector table for writes as well as reads.
`storeSegmentEmbeddings(companyId, rows, opts)` lives beside `retrieve()`, and
the guard stays exactly as strict.

The tenant comes from the `companyId` argument and nowhere else. Callers pass
segment ids and vectors; they cannot pass a `company_id` per row, so no caller
can write a row into the wrong tenant even by mistake. The composite foreign
key `(company_id, segment_id)` then rejects a segment that belongs to another
company: the database refuses the row rather than this code trusting its
caller.

## Consequences

`packages/ai/src/retrieval` is now the module for the vector table rather than
for queries. The name is slightly wrong; the boundary is right, and renaming a
directory that a CI guard matches by path is a change to make deliberately,
not in passing.

The ingest writer in `packages/ai/src/ingest` depends on the retrieval module.
That is the intended direction: anything that touches vectors reaches them
through one door.

The guard keeps its bluntness. It was tempting to add an exception for a
writer module instead, and the first exception is what makes the second one
easy to argue for.

## Alternatives

**Relax the guard to allow a writer elsewhere.** Cheaper today. The guard's
whole value is that it needs no judgement to apply: one regex, one allowed
path. An allowlist that grows by one entry per phase stops being a guard.

**Write embeddings through a SQL function, like `match_segments`.** It would
move the tenant check into the database, which sounds stronger, but the check
that matters — the caller cannot express a tenant — is already achieved by the
function signature. This would add a migration and an RPC round trip for no
additional guarantee.
