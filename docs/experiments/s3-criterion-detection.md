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

## Conclusions

**1. Accuracy is good enough to proceed on.** 84% F1 on a five-criterion
scorecard, with the weakness concentrated in one criterion: `timeline_stated`
at 57% F1. It missed "we're on a July renewal" and "he retires in November",
and it counted the seller's "renewal is in six weeks" as the customer stating
a timeline. A tighter definition — the customer's own words, about the change
they are considering — is the obvious next iteration, and the corpus will say
whether it worked.

**2. Latency misses the budget by 3x, and the cause is not the model.**
Average output is 178 tokens per call. At Haiku's generation rate that is most
of the 2.1 seconds; the model is not slow to start, it is being asked to write
too much. The levers, in the order worth trying:

- Shorter observations. `polarity`, `confidence`, `segment_id`, `quote` per
  observation is verbose; a quote is the bulk of it. Capping quotes to a short
  phrase should cut output materially.
- Fewer observations per call. A rolling window overlaps its neighbours, so
  the same evidence gets re-reported; asking only for what is new in this
  window would shrink output and cost together.
- Streaming does not help the number that matters here. The scorecard cannot
  update until the whole JSON object is parseable, so time-to-last-token is
  the budget, not time-to-first.

Swapping models is the last lever, not the first — a faster model writing 178
tokens still spends most of a second doing it.

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

- Re-run with a terser output shape and re-measure latency.
- Sharpen `timeline_stated` and re-measure.
- Run a local model through the same harness (`--model` accepts an Ollama id
  once a chat model is pulled) for the cost and latency comparison.
- Replace whole-conversation windows with real rolling windows once a long
  transcript exists.
