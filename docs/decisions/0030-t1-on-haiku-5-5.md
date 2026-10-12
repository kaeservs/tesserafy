# 0030 — The criterion detector runs on Haiku 5.5, with thinking off and no temperature

**Status:** proposed · 2026-10-11 · amends ADR 0002's model routing for T1

## Context

The owner asked whether the AI could cost less. Production's usage log put
the detector (T1) at a third of all model spend, and it is the cost that grows
with use: a live call makes a detector call for every line the customer says,
roughly 180 an hour, at about $0.0018 each on `claude-haiku-4-5`.

`claude-haiku-5-5` was released on 2026-10-07 at $0.10 / $0.50 per million
tokens in and out, a tenth of Haiku 4.5's $1 / $5 (pricing page, read
2026-10-11). Its tokenizer counts about 30-40% more tokens for the same text
(the detector's prompt: 429 tokens on Haiku 4.5, 601 on Haiku 5.5, by the
free token-counting endpoint), so the saving per call is less than the price
cut, not equal to it.

Two of its differences touch decisions this tier rests on:

- **It rejects `temperature: 0`.** Any value but 1 is a 400. T1 has pinned
  zero since eight runs over one identical window, on Haiku 4.5 at the
  default, produced five distinct results and three different sets of
  criteria (`benchmarks/results.md`).
- **It thinks by default.** Adaptive thinking adds latency the live budget
  (ADR 0002, revised by ADR 0010) cannot pay for. It accepts
  `thinking: {type: "disabled"}` at `high` effort or below; the default is
  `medium`.

## What was measured

`services/eval`, criteria v1, ten discovery calls and 28 labels, graded by
span overlap (ADR 0009). Haiku 5.5 with thinking off and no temperature;
Haiku 4.5 at zero, as it ran in production. Called from a laptop, so the
latencies compare the two models with each other, not with the budget.

**A stored call, as the product scores it** (`spike_s3 --stride 46`: one
window per call):

| Model | Runs | Precision | Recall | F1 | Latency p50 | Cache read | Per call |
|---|---|---|---|---|---|---|---|
| `claude-haiku-4-5` | 3 | 77% | 86% | **81%** (all three) | 2.70-2.80 s | 0 of 30 calls | $0.0020 |
| `claude-haiku-5-5` | 4 | 79-84% | 89-96% | **85-89%** | 2.19-2.25 s | 39 of 40 calls | $0.00015 |

By criterion, Haiku 5.5's four runs against Haiku 4.5:

| Criterion | Haiku 4.5 | Haiku 5.5 |
|---|---|---|
| `timeline_stated` | 75% | **100%** in every run |
| `budget_indicated` | 100% | 100% |
| `desired_outcome_stated` | 93% | 93% |
| `current_process_known` | 78% | 78-90% |
| `pain_quantified` | 75% | 71-80% |

`timeline_stated` was the criterion two rounds of rewording could not fix
(the seller's "renewal is in six weeks" counted, "he retires in November"
missed). Haiku 5.5 gets it right in all four runs. The movement between its
runs lands on `pain_quantified` and `current_process_known`.

**A live call's shape** (`--stride 1 --window 3`), one run each:

| Model | Precision | Recall | F1 | Latency p50 per call | Run cost |
|---|---|---|---|---|---|
| `claude-haiku-4-5` | 57% | 86% | 69% | 5.7 s | $0.043 |
| `claude-haiku-5-5` | 68% | 96% | 79% | 4.8 s | $0.0029 |

(Latency here is per call, which in this mode is a whole transcript's
windows; the comparison holds, the figures do not transfer.)

The frozen prefix with its output schema is ~1,050 tokens on Haiku 5.5, over
its 512-token minimum, so the cache engages for the first time on this tier:
each call after the first pays full price only for the window.

## Decision

1. **T1 runs on `claude-haiku-5-5`** (`T1_MODEL`).
2. **With thinking off and no temperature** (`samplingFor`). A spike that
   passes `--model claude-haiku-4-5` still gets temperature zero, so the two
   can be compared again.
3. **The console prices it** (`private.usage_usd`, which `admin_companies`
   now calls instead of carrying its own copy of the arithmetic): any model
   it did not name was priced at Haiku 4.5's rate, ten times this one.

The detector's prompt is unchanged (`t1-detect@2026-09-19`); results carry
their model, so stored criterion events say which one produced them.

## Consequences

- About nine tenths off every detector call: roughly $0.32 an hour of live
  call becomes $0.03, and scoring an imported hour-long meeting, $0.05-0.12
  by ADR 0014's estimate, becomes around a cent. A third of the product's
  model bill was the detector; what is left is mostly T2 and T3 on Sonnet 5.
- **The detector samples again.** Four runs spread over four points of F1,
  where Haiku 4.5 at zero gave the same figure three times. Every one of
  those runs beat Haiku 4.5, and criteria latch (invariant 2), so the spread
  shows as which criteria a call reaches, never as a score that flickers.
  Quote a range.
- Faster, not slower: about a fifth less per call in both modes. The live
  budget stays as ADR 0010 set it.
- **Not yet measured:** real transcripts, which are the corpus this whole
  file of evidence keeps asking for; a company's own scorecard; guidance in
  the prefix. Each moves the prompt, not the model, and the harness can
  repeat this comparison on them by passing `--model`.
- Extraction and Assist on Haiku 5.5 (a twentieth of Sonnet 5) were left for
  a separate decision; the extraction comparison is in `benchmarks/results.md`.
