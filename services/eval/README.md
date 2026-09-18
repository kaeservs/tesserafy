# services/eval

Python evaluation harness and labelling CLI. Not a runtime dependency of the
web app. Standard library only — no virtualenv, no install step.

## Why Python here and TypeScript everywhere else

The corpus, the matching rule and the report live here. The *prompts do not*:
predictions come from `pnpm extract`, the same T0 + T3 path the product runs.
A harness that re-implemented the prompt would drift from what ships, and then
the number would measure something no customer ever sees.

## Running

    cd services/eval

    # Validate the corpus. No model, no cost — checks every label resolves to
    # exactly one span of one segment.
    python -m harness.run datasets/v1/discovery-calls.jsonl --dry-run

    # Measure. Calls claude-opus-5 once per conversation; needs ANTHROPIC_API_KEY.
    python -m harness.run datasets/v1/discovery-calls.jsonl

    # The matching rule's own tests.
    python -m unittest discover -s tests -t .

Run output goes to `runs/`, which is gitignored. A run worth keeping gets its
numbers copied into `benchmarks/results.md` with its date.

## What is measured, and what is not

| Dimension | Status |
|---|---|
| Problem detection | precision / recall / F1 |
| Feature-request detection | precision / recall / F1 |
| Criterion correctness | **not measured** — needs T1 detectors and criteria seed rows |
| Paraphrase rate | claims the extractor dropped because the quote was not verbatim |

A prediction counts as correct when its kind matches and its evidence overlaps
the labelled span in the same segment (ADR 0009). Scoring involves no model,
so two runs a month apart are comparable.
