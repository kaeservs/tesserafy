# S3 — Criterion detection from a short window

**Question:** can `claude-haiku-4-5` detect criteria accurately from a ~600
token window, inside the 700 ms T1 budget? How does a local model compare?

**Status:** first result, 2026-09-19. Local model not yet run.

## Method

Five criteria for a discovery call (`services/eval/datasets/criteria/discovery-v1.json`),
ten labelled windows, 28 labels
(`services/eval/datasets/v1/criteria-windows.jsonl`). Each window is a whole
short conversation rather than a slice of a long one — an approximation of a
rolling window, and the first thing to fix when longer transcripts arrive.

Graded by the same span-overlap rule as T3 (ADR 0009): a detection counts only
when it cites words that overlap the labelled span. Each window was run twice
so the second call could read the prompt cache.

    python -m harness.spike_s3 datasets/v1/criteria-windows.jsonl \
      --criteria datasets/criteria/discovery-v1.json --repeat 2

## Result — `claude-haiku-4-5`

| Criterion | Precision | Recall | F1 |
|---|---|---|---|
| **Overall** | **83%** | **86%** | **84%** |
| pain_quantified | 78% | 100% | 88% |
| current_process_known | 88% | 78% | 82% |
| desired_outcome_stated | 88% | 100% | 93% |
| timeline_stated | 67% | 50% | 57% |
| budget_indicated | 100% | 100% | 100% |

Latency: **p50 2153 ms, p95 3459 ms** against a 700 ms budget.
Cache: **0 of 20 calls read the prefix.**
Cost: $0.0019 per call — about **$0.25 for a 45-minute call** at ~135 calls.
Two observations were dropped for quoting text that was not in the window.

## Result — terser output, and where the time actually goes

The first write-up blamed latency on output size: 178 tokens per call at
Haiku's generation rate is most of two seconds. That was wrong, and the
experiment that settled it took four cents.

A `compact` variant asks for quotes of at most ten words and at most three
observations per window:

| Variant | Precision | Recall | F1 | Output/call | p50 | p95 |
|---|---|---|---|---|---|---|
| full | 83% | 86% | 84% | 178 tok | 2153 ms | 3459 ms |
| compact | 87% | 71% | 78% | 134 tok | 2065 ms | 2251 ms |

**A quarter less output bought four per cent less latency.** Time per output
token went *up*, which only happens when a fixed cost dominates. Three timed
calls of each shape, from this machine:

| Call | Samples | Output |
|---|---|---|
| Plain, tiny prompt | 732 / 883 / 1828 ms | 4 tokens |
| Structured output, tiny prompt | 834 / 2076 / 3238 ms | 9 tokens |
| Plain, ~100 words | 2243 / 2305 / 2451 ms | 139 tokens |

So the shape of T1 latency is roughly **750 ms of fixed cost plus 10-12 ms per
output token**, with structured output adding a wide variance band on top.

## Conclusions

**1. Accuracy is good enough to proceed on.** 84% F1 on a five-criterion
scorecard, with the weakness concentrated in one criterion: `timeline_stated`
at 57% F1. It missed "we're on a July renewal" and "he retires in November",
and it counted the seller's "renewal is in six weeks" as the customer stating
a timeline. A tighter definition — the customer's own words, about the change
they are considering — is the obvious next iteration, and the corpus will say
whether it worked.

**2. The 700 ms budget is unreachable from here, and shortening the output
does not rescue it.** A four-token response costs 732 ms at its fastest. The
budget is spent before the model says anything useful, so no amount of prompt
tightening gets T1 under it from this machine. Trimming output is still worth
having — the compact variant cut p95 by a third, from 3459 ms to 2251 ms,
which matters for the tail — but it is a variance fix, not a budget fix.

What the fixed cost is made of, in the order worth attacking:

- **Network round trip.** These calls leave a laptop in Dubai for the API. A
  T1 caller running server-side near the model region should see a much lower
  floor; that is a deployment-topology question, and the live path's topology
  is not decided yet. Measuring it needs a host in that region, which this
  spike did not have.
- **Structured output variance.** The same tiny prompt ranged 834-3238 ms with
  a schema attached versus 732-1828 ms without. Worth re-testing with a plain
  JSON instruction and a tolerant parser.
- **On-device inference removes the round trip entirely.** A local model has no
  network floor at all, which reframes the local-model question: it is not
  only about cost, it may be the only way to reach the budget from a client.

Note the compact variant also traded accuracy — F1 78% against 84%, losing
recall — so it is not free even where latency is not the constraint. The
default stays `full`.

**3. Prompt caching never engaged — 0 tokens read, 0 written.** The frozen
prefix here is the system prompt plus five criteria, roughly 450 tokens, and
Haiku 4.5's minimum cacheable prefix is larger than that. Nothing errors; the
cache simply does not happen, which is exactly the silent failure ADR 0002
warns about.

The consequence for the cost model is direct: caching only starts paying once
the frozen prefix (system + criteria definitions + context pack) is past the
model's minimum. Below it, the `cache_control` marker is decoration. The live
cost estimate in ADR 0002 assumed caching; at 450 tokens of prefix the input
cost is small anyway, but that stops being true the moment a context pack is
added — which is precisely when the cache needs to work.

**Measure `cache_read_input_tokens` before relying on any of it.** This spike
existed to find that, and it did.

## Next

- **Run a local model through the same harness.** Now the decisive experiment,
  not a cost footnote: it is the only configuration with no network floor.
- **Measure T1 from a host near the model region**, to separate network cost
  from model cost. Until that number exists, ADR 0002's 1.3 s
  utterance-to-score budget rests on an untested assumption about where T1
  runs.
- Sharpen `timeline_stated` and re-measure.
- Run a local model through the same harness (`--model` accepts an Ollama id
  once a chat model is pulled) for the cost and latency comparison.
- Replace whole-conversation windows with real rolling windows once a long
  transcript exists.
