# 0002 — Tiered AI architecture split by latency tolerance

**Status:** accepted · 2026-09-12

## Context

The product ships two surfaces with incompatible timing requirements. The
post-call intelligence path can spend thirty seconds and several model calls
on one transcript. The live HUD has roughly 1.5 seconds between someone
finishing a sentence and the scorecard needing to reflect it.

A frontier model cannot sit in that hot loop. But building the batch pipeline
first and retrofitting realtime later means rewriting the extraction layer,
because batch extraction naturally takes a whole transcript and live extraction
must take a rolling window.

## Decision

Four tiers, split by how much latency each can tolerate rather than by feature.

| Tier | Job | Budget | Model |
|---|---|---|---|
| T0 | Segmentation, endpointing, redaction, window assembly | < 10 ms | none — pure TS |
| T1 | Criterion detectors | <= 700 ms | `claude-haiku-4-5` |
| T2 | Live suggestions | <= 3.5 s | `claude-sonnet-5` |
| T3 | Post-call extraction, clustering, synthesis | unbounded | `claude-opus-5` |

T1 returns evidence spans only. T2 is off the critical path — the score updates
without waiting for it. Both the live and batch paths write into the same
tables, so an insight can cite live-captured and imported evidence
interchangeably.

Live requests put the frozen prefix (system prompt, criteria definitions,
context pack) before the cache breakpoint and the rolling window after it. A
45-minute call makes roughly 135 T1 calls; without caching, each re-pays for
the entire prefix.

## Consequences

- More work in Phase 1 than a single pipeline would need, and substantially
  less in Phase 6.
- Cost per live 45-minute call lands near $1.00–1.15 against $0.12 for
  post-call only. This is what makes live minutes a separate pricing question.
- Cache correctness becomes load-bearing: a `Date.now()` in the system prompt
  silently invalidates the prefix and multiplies T1 cost. Assert
  `usage.cache_read_input_tokens` is non-zero.
- Model choice per tier is now a swappable decision the eval harness can test,
  which is the point at which "model routing" becomes real rather than a
  buzzword.

## Alternatives considered

- **One model for everything.** Opus in the hot loop misses the budget; Haiku
  everywhere is not good enough for insight synthesis.
- **Local models for T1 from the start.** Attractive on cost and latency, but
  unmeasured. Spike S3 tests it against Haiku on labelled snippets — this ADR
  does not preclude switching, it makes switching a measured decision.
- **Ship post-call only, add live later.** Rejected: the live HUD is committed
  scope, and the retrofit cost is the whole extraction layer.
