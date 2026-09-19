# 0010 — The live latency budget, as measured

**Status:** proposed · 2026-09-19 · amends the budget table in ADR 0002

## Context

ADR 0002 budgets 700 ms for T1 criterion detection and ~1.3 s from utterance
to visible score. Those numbers were written before anything had been
measured; they were a target, and reasonable as one.

Spike S3 measured them. The results are in
`docs/experiments/s3-criterion-detection.md`; the parts that matter here:

| Configuration | T1 model time (p50) |
|---|---|
| `claude-haiku-4-5`, called from a laptop | 2153 ms end to end |
| `claude-haiku-4-5`, called server-side in `iad1` | **1432 ms** |
| Same, with a deliberately terser output shape | 1453 ms |
| `qwen3:4b` on local CPU | 53,948 ms |

Three findings, each independently confirmed:

1. **The floor is the model, not the plumbing.** Co-locating the caller with
   the API removed ~840 ms of network and left 1432 ms. Our own endpoint
   overhead measured under 2 ms — there is nothing left to trim on our side.
2. **It is not output-bound.** Cutting output by a quarter moved p50 by 21 ms.
   A four-token reply still costs 732 ms at its fastest.
3. **On-device inference is worse, not better.** The local arm was 25x slower
   at a quarter of the accuracy (25% F1 against 84%).

Detection accuracy is fine — 84% F1 on five criteria. The problem is only that
the budget was invented rather than measured.

## Decision

**The scorecard settles asynchronously, and the budget becomes ~2 s.**

| Stage | ADR 0002 | Measured / revised |
|---|---|---|
| Speech → interim transcript | 300 ms | unchanged, untested (spike S2) |
| Utterance boundary detection | 200 ms | unchanged, untested |
| Criterion detection (T1) | 700 ms | **1450 ms measured** |
| State reconcile + score | 20 ms | unchanged (pure function, no I/O) |
| IPC → overlay repaint | 80 ms | unchanged, untested |
| **Utterance → visible score** | **~1.3 s** | **~2.05 s** |

Two rules follow, and they are what make 2 s acceptable rather than merely
true:

- **The overlay never blocks on detection.** It shows what it knows, and
  updates when evidence arrives. There is no spinner on the scorecard and no
  "thinking" state, because a scorecard that visibly waits invites the user to
  wait with it.
- **Criterion state remains latching (invariant 2).** A late-arriving
  detection can only add, so a slow response is invisible rather than a
  flicker. This is what lets a 2 s update feel like a scorecard that is simply
  up to date.

## Consequences

The product promise changes from "live to the second" to "up to date within a
couple of seconds", and the HUD's design must not claim more than that — no
timers, no live-tick animation, nothing that invites a user to notice the lag
they would otherwise ignore.

T1 runs server-side. The `/api/detect` endpoint built alongside this ADR is
the shape: it holds an Anthropic key, no database credentials, and accepts a
bearer token so the overlay can call it without a cookie jar. Running T1 from
the client would add back the ~840 ms that measurement says we cannot afford.

The cost model in ADR 0002 is unaffected: $0.0019 per T1 call measured,
~$0.25 for a 45-minute call, in line with what that ADR assumed. Note that
prompt caching **never engaged** in any measured run — the frozen prefix is
below Haiku's minimum cacheable size — so the assumed caching saving is not
being realised today and the cost above is the uncached one.

P6's gate — measured p50/p95 for utterance to visible score — is now judged
against 2 s. The live scorecard page measures it in the browser, where a user
would feel it, and displays the budget beside the measurement.

## Alternatives

**Keep 1.3 s and make T1's task smaller.** Classify the window, quote later.
Cheaper per call, and it breaks invariant 4: a criterion state without a
quoted span is not evidence, and the product's whole claim is that every state
is evidenced. Rejected — the invariant is more valuable than the second.

**Keep 1.3 s and use a smaller model.** The measured floor for a four-token
reply is 732 ms; a faster model might reach the budget, but S3's local arm
shows what happens to accuracy when capability drops, and 25% F1 is not a
scorecard, it is noise. Worth revisiting only with a measured candidate.

**Wait for faster inference.** Plausible on a year's horizon, unhelpful for a
product being built now, and it would leave the HUD designed around a promise
it cannot keep in the meantime.
