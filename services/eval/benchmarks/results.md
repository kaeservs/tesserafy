# Committed results

One row per run worth keeping. Numbers are only comparable within a corpus
version, and only meaningful next to the detector that produced them.

| Date | Corpus | Items | Detector | Model | Overall P / R / F1 | Problem P / R | Feature request P / R | Paraphrase |
|---|---|---|---|---|---|---|---|---|
| 2026-09-18 | v1 discovery-calls (synthetic) | 1 | `t3-extract@2026-09-17` | `claude-opus-5` | 50% / 67% / 57% | 50% / 50% | 50% / 100% | 0% |

## Reading the first row

**It measures the harness, not the extractor.** One conversation and three
labels cannot support a claim about quality; every count moves the percentages
by tens of points. It is committed because the phase gate asks for a number
with the date it was measured, and because the failures it surfaced are
informative:

- **One miss.** The transcript states two distinct problems in one segment —
  the export costing a Friday, and a column being mistyped. The extractor
  returned a single signal quoting the whole segment. Matching is one-to-one,
  so it scored one hit and one miss. Whether that is a model failure or a
  labelling convention worth revisiting is exactly the question a corpus is
  for; the rule in `datasets/v1/README.md` says two signals, so for now it
  counts as a miss.
- **Two false positives.** One is a feature request the extractor found and
  the corpus does not label ("the warehouse team works nights, so timing
  matters"). Reasonable reading, unlabelled — a gap in the labels rather than
  a fault in the model. The other is the second half of the merged problem
  above.

Both are the harness doing its job: disagreements between what a labeller
expected and what the model produced are the only thing that makes a number
worth running.

## Not measured

Criterion correctness. It needs T1 detectors and criteria seed rows, which do
not exist yet (ADR 0009).
