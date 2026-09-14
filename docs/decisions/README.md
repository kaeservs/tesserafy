# Architecture decision records

One file per decision: `NNNN-short-slug.md`. Format is deliberately short —
context, decision, consequences, alternatives. A decision is recorded when it
would be expensive to reverse or when a future reader would otherwise ask
"why on earth is it like this?".

Status is `proposed`, `accepted`, or `superseded by NNNN`. Never edit an
accepted ADR to change the decision; write a new one that supersedes it.

| # | Decision | Status |
|---|---|---|
| 0001 | pnpm monorepo with a dependency-free scoring package | accepted |
| 0002 | Tiered AI architecture split by latency tolerance | accepted |
| 0003 | Deterministic scoring over latching criterion states | accepted |
| 0004 | Tenant isolation enforced in the retrieval layer | accepted |
| 0005 | pgvector installed in the `extensions` schema | accepted |
| 0006 | Scoring rules ADR 0003 left open | proposed |
