The guarded retrieve().

companyId is a required positional argument. This is the only place in the
codebase permitted to construct a vector or evidence query. The AI pipeline
runs with a service-role key that bypasses RLS, so this function is the real
tenant boundary — see docs/decisions/0004-tenant-isolation-in-retrieval.md.

The cross-tenant test in packages/ai/test is release-blocking.

## Writing

This directory owns the vector table, reads and writes alike (ADR 0008).
`storeSegmentEmbeddings()` takes the tenant as its first argument, the same
way `retrieve()` does, so no caller can supply a per-row `company_id`.

## Knowledge

The same `retrieve()` searches a company's knowledge (the documents its
sellers answer from) with `corpus: 'knowledge'`, through `match_knowledge`,
and checks every passage's company as it does every segment's.
`storeKnowledge()` writes a document's passages and vectors, tenant first.
One function for both corpora on purpose: two would be two places to get the
tenant wrong.
