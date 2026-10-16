# 0006 — Scoring rules ADR 0003 left open

**Status:** proposed · 2026-09-15

## Context

ADR 0003 defines the criterion state machine and its thresholds. Implementing
it in `packages/scoring` exposed four cases it does not settle. Each changes
the score a user sees, so each is recorded rather than left to whatever the
code happens to do. This refines 0003; it does not supersede it.

## Decision

1. **"Independent spans" means distinct transcript segments.** Two spans from
   the same segment are one observation. A span reported twice (detector
   retry) is one piece of evidence at the higher confidence.
2. **A contradiction demotes only at or above the `confirm` threshold.**
   Demotion is the one thing that moves a score backwards, so it needs the
   same certainty confirmation does. Weaker contradictions are ignored.
3. **Contradicted can return to confirmed, on fresh evidence only.** Evidence
   recorded after the latest contradiction must satisfy the confirm rule by
   itself. Evidence from before the contradiction never counts toward
   overturning it. Contradicted never falls back to candidate.
4. **A contradiction on an unobserved criterion changes no status.** There is
   nothing to contradict. The span is kept so the scorecard can show it.

A candidate can be contradicted as well as a confirmed criterion, as the
state diagram in `packages/scoring/src/state` already showed.

## Consequences

- The monotonicity property is testable exactly as P2's gate states it: the
  score drops only on a contradiction event. Property tests over 500 seeded
  sequences check it, alongside allowed-edge and evidence-citation checks.
- A conversation that genuinely changes its mind ("no budget" … "we found
  budget") ends confirmed, with both reversals in the transition log.
- Rule 2 means contradiction detectors need high precision to have any effect
  at all. Phase 3 should measure them separately from evidence detectors.

## Alternatives considered

- **Contradicted is terminal.** Simplest, and maximally stable, but wrong for
  real conversations that correct themselves.
- **Any evidence overturns a contradiction.** Makes the contradiction
  meaningless: the evidence it contradicted would immediately re-confirm.
- **Independence by time gap rather than segment.** Needs a tuning constant
  with no data to tune it; segments are already the evidence unit.

## Addendum — the same span means the same words (2026-10-14)

Rule 1 called a span reported twice one piece of evidence, and the engine
decided "the same span" by segment and times alone. On a stored call every
span carries its segment's own times, so any two quotes from one segment
were "the same span". A person's "it was met", quoting other words of the
segment whose detector claim they had just called wrong, was taken for a
re-report of that contradicted claim, kept its old position, and could never
overturn the contradiction (rule 3).

The same span is now the same segment, times **and quote**. A detector retry
still reports the same words and still counts once. Other words from the
same segment are another quote, and still one observation toward
corroboration, which counts segments. A contradicted criterion's shortfall
counts only evidence newer than its latest contradiction, as rule 3 does.
