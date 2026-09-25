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
| 0004 | Tenant isolation enforced in the retrieval layer | accepted; service-role-only part superseded by 0011 |
| 0005 | pgvector installed in the `extensions` schema | accepted |
| 0006 | Scoring rules ADR 0003 left open | proposed |
| 0007 | Signals and their evidence | proposed |
| 0008 | The retrieval module owns writes to the vector table | proposed |
| 0009 | What counts as a correct extraction | proposed |
| 0010 | The live latency budget, as measured | proposed |
| 0011 | Retrieval under the user's session (amends 0004) | proposed |
| 0012 | The operator console creates accounts (amends invariant 3) | proposed |
