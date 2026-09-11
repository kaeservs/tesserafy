# 0004 — Tenant isolation enforced in the retrieval layer

**Status:** accepted · 2026-09-12

## Context

Tesserafy is multi-tenant: one Supabase project, `company_id` on every
tenant-owned row, Row Level Security on every table. That is the standard
Supabase pattern and it is correct for anything the browser touches.

It is not sufficient here.

The AI pipeline runs server-side with a service-role key, and a service-role
key **bypasses RLS entirely**. Every embedding search, every evidence lookup,
every cross-conversation cluster runs under that key. The failure mode is a
retrieval query that omits the tenant filter, pulls Customer A's transcript
chunk into a prompt, and surfaces it as Customer B's evidence.

That failure is silent. Nothing errors. The output looks plausible. It is
discovered by a customer reading a competitor's words in their own insight
feed, which is the kind of incident a young product does not survive — and RLS
will not catch it, because RLS is not in the path.

## Decision

Exactly one function may construct a vector or evidence query:

    retrieve(companyId, query, opts)

in `packages/ai`. `companyId` is a required positional argument, not an
optional filter in an options bag — omitting it is a type error, not a silent
full-corpus search.

A test seeds two companies with overlapping content and asserts a cross-tenant
query returns zero rows. It runs in CI from Phase 0 and is treated as a
release-blocking test, not a nice-to-have.

RLS stays enabled on every table as defence in depth.

## Consequences

- Ad-hoc `supabase.from('signal_embeddings').select()` calls in feature code
  are a review failure. Everything goes through `retrieve()`.
- The guard is enforceable by grep and by type signature, which is what makes
  it survive contributors and future sessions.
- Some flexibility is lost — a genuinely cross-tenant query (aggregate
  benchmarks across customers, if that is ever built) will need an explicit,
  separately-named, separately-audited function. That friction is deliberate.

## Alternatives considered

- **RLS alone.** Does not apply to the service-role key. This is the entire
  reason for the ADR.
- **Run the AI pipeline under the user's JWT so RLS applies.** Genuinely
  appealing, and worth revisiting. Rejected for now because background jobs
  (bulk import in P4, nightly clustering in P5) have no user session, so the
  service-role path is needed regardless and would become the unguarded gap.
- **A database view that pre-filters by tenant.** Still needs the caller to
  pass the right tenant. Moves the problem without solving it.
