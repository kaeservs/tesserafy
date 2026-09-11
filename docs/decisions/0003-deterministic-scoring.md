# 0003 — Deterministic scoring over latching criterion states

**Status:** accepted · 2026-09-12

## Context

The engagement scorecard is the signature element of the live overlay. The
obvious implementation — ask the model for a score — fails in two ways.

It cannot explain itself: a user who sees 72 has no way to learn why it is not
81, which makes the number advice-free decoration.

Worse, it is unstable. As partial transcript arrives, a model re-scoring the
conversation returns 72, then 64, then 71. A score that visibly goes backwards
mid-conversation destroys trust inside a single call, and no amount of UI
smoothing repairs that.

## Decision

The model never produces a score. It produces evidence.

Each criterion is a state machine:

    unobserved -> candidate -> confirmed
                           \-> contradicted

| Transition | Trigger |
|---|---|
| unobserved -> candidate | one evidence span at confidence >= 0.55 |
| candidate -> confirmed | a single span >= 0.80, or two independent spans >= 0.55 |
| confirmed -> *nothing* | **latching — absence of evidence never demotes** |
| confirmed -> contradicted | explicit negation detector only, recorded as an event |

    score = sum(weight of confirmed) / sum(weight of all) * 100

recomputed only on a state transition. Criteria definitions are seed data —
`(engagement_type, key, label, weight, prompt, thresholds)` — versioned in the
database, and the version is pinned on each conversation so historical scores
stay reproducible after weights are retuned.

## Consequences

- The latching rule is what removes the flicker. It is a product decision as
  much as a technical one: the scorecard measures what has been covered, and
  coverage does not un-happen.
- The scoring engine becomes a pure function over a sequence of detector
  outputs — no network, no model, no clock. The entire scorecard is testable by
  feeding synthetic detector sequences and asserting the score trajectory.
- Every point traces to a quoted span with a timestamp, so "why is it 72?" has
  a real answer.
- A criterion confirmed on a false positive stays confirmed for the rest of the
  call. This is the accepted cost of stability, and it makes T1 detector
  precision the metric that matters most — which is what Phase 3 measures.
- Adding an engagement type is a seed row, not a deploy.

## Alternatives considered

- **LLM-generated score.** Rejected above.
- **Re-score the full transcript each time.** Stable only if the model is
  deterministic, which it is not, and it blows the latency budget.
- **Display smoothing over a noisy score.** Hides the instability without
  fixing it, and makes the explanation wrong rather than absent.
- **Allow demotion on sustained absence.** Considered for criteria like
  "engagement", where regression is meaningful. Deferred — no engagement type
  in the first two scorecards needs it, and it can arrive as a per-criterion
  flag without changing the model.
