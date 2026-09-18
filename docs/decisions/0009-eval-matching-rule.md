# 0009 — What counts as a correct extraction

**Status:** proposed · 2026-09-18

## Context

Phase 3 commits a precision and recall number for problem detection and
feature-request detection. Before any number can be produced, one question has
to be settled: when does a predicted signal count as the labelled one?

The model paraphrases by design — a summary is supposed to be in the
customer's terms, not a transcript quote — so string equality between a
predicted summary and a labelled one would score every correct extraction as a
miss. Something has to decide that "the weekly export costs most of a Friday"
and "they lose a Friday afternoon to the report" are the same finding.

## Decision

A prediction matches a label when **the kind agrees and the prediction's
evidence overlaps the labelled span in the same segment.** Matching is greedy
and one-to-one, strongest overlap first.

Summaries are not compared at all. The product's claim is that every signal is
backed by the words it came from, so "did it find the right words" is the
question that matters; a signal that quotes the wrong sentence is wrong no
matter how well it reads.

Scoring runs no model. Metrics are reported per kind and overall, and an
undefined rate is reported as null rather than zero.

Alongside the headline numbers the harness reports a **paraphrase rate**: the
share of claims the extractor itself dropped because their quote could not be
found verbatim. Those never reach a user, so it is not an error rate — it is
the earliest signal that a prompt change is pushing the model away from
quoting.

## Consequences

Labels are cheap to write and hard to get subtly wrong: a labeller quotes the
transcript, and the harness refuses any quote it cannot locate in exactly one
segment. No one hand-counts character offsets.

The metric is stable across time. Two runs a month apart differ only because
the extractor differed, which is the entire point of committing a number with
the date it was measured.

One-to-one matching means a single vague signal spanning a whole paragraph
cannot satisfy two labels in it. That is intended: finding one of two problems
is recall of one half, not one.

The rule is blind to summary quality. A signal that quotes the right words and
describes them badly scores as correct. That is a real gap, and the honest
place to close it is a separate, explicitly subjective review — not by
smuggling a judge into the headline metric.

Criterion correctness, the third dimension the phase gate names, is reported as
*not measured*. It needs T1 detectors and criteria seed rows, neither of which
exists yet. A placeholder number would be worse than an absent one.

## Alternatives

**An LLM judge for summary equivalence.** Handles paraphrase gracefully, and
makes the metric move whenever the judge model or its prompt changes — so a
series of measurements stops being comparable, and the harness inherits the
failure mode it exists to detect. Reasonable later as a second, separately
reported number; not as the headline.

**Exact or fuzzy string match on summaries.** Deterministic and wrong: it
measures phrasing, and the phrasing is meant to vary.

**Optimal (Hungarian) assignment instead of greedy.** More correct in
principle. With a handful of signals per conversation the two agree, and
changing the algorithm later would silently move historical numbers.
