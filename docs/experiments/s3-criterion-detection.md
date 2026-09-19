# S3 — Criterion detection from a short window

**Question:** can `claude-haiku-4-5` detect criteria accurately from a ~600
token window, inside the 700 ms T1 budget? How does a local model compare?

**Status:** complete, 2026-09-19. Both arms measured, plus the server-side
topology the first two results pointed at.

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

## Result — a local model

`qwen3:4b` through Ollama on this machine's CPU, same prompt, same window
rendering, same quote rule, same grading:

| Arm | Precision | Recall | F1 | p50 | p95 |
|---|---|---|---|---|---|
| `claude-haiku-4-5` | 83% | 86% | 84% | 2153 ms | 3459 ms |
| `qwen3:4b` (local, CPU) | 42% | 18% | **25%** | **53,948 ms** | 70,163 ms |

Per-criterion recall was 14% / 22% / 29% / 0% / 0%: it found almost no
`timeline_stated` or `budget_indicated` at all. Its false positives were the
wrong kind of wrong — it quoted the *seller* ("Our tablets capture that at the
line", "Renewal is in six weeks"), which the prompt forbids in the most
explicit rule it has.

Twenty-five times slower for a quarter of the accuracy. On this hardware, at
this size, this is not a candidate.

## Result — running T1 beside the model

Both client-side arms missed the budget, so the remaining candidate was to run
detection server-side near the model. `/api/detect` deployed to `iad1`, six
runs each, measured by `pnpm measure:t1`:

| Configuration | Model p50 | Caller waits (p50) |
|---|---|---|
| From this laptop (client-side) | — | 2153 ms |
| Server-side, full output | **1432 ms** | 2269 ms |
| Server-side, compact output | **1453 ms** | 2510 ms |

Co-location removes about 840 ms of network. Endpoint overhead is nil —
`serverMs` and the model's own duration differ by under 2 ms — so there is
nothing left to trim on our side of the call.

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

**3. The 700 ms T1 budget is not reachable at all, from anywhere.** This is
the finding that outlives the spike. The model alone takes 1432 ms for this
task, co-located, with no network in the way and no overhead of ours. Compact
output changes it by 21 ms — the third independent confirmation that latency
here is not output-bound but a floor for the task shape.

ADR 0002 budgets 700 ms for T1 and 1.3 s from utterance to visible score. That
was written before anything was measured, and measurement now contradicts it.
Three honest responses, none of them purely technical:

- **Revise the budget** to what is achievable: ~1.5 s detection, so roughly
  2 s utterance-to-score. Live still feels live at 2 s; it is a different
  product promise from 1.3 s, and the HUD's design should say which it makes.
- **Make T1's task smaller.** Every measured configuration asks the model to
  find evidence *and* quote it. A detector that only classified, with quoting
  done afterwards, is a different and cheaper request — but invariant 4 says
  a criterion state without a quoted span is not evidence, so this trades
  against the product's central claim.
- **Let the scorecard settle asynchronously.** The score updates when
  detection lands rather than pretending to be live to the second. This is the
  cheapest change and the most honest about what the system can do.

**4. Prompt caching never engaged — 0 tokens read, 0 written.** The frozen
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

- **Decide what ADR 0002's budget becomes.** The measurements are in; the
  choice between a revised budget, a smaller T1 task and an asynchronous
  scorecard is a product decision, and P6 cannot be planned without it.
- Sharpen `timeline_stated` (57% F1, the weakest criterion) and re-measure.
- Re-test with a plain JSON instruction instead of a schema: the tiny-prompt
  probe showed structured output widening the variance band (834-3238 ms
  against 732-1828 ms), which matters for p95 even if it does not move p50.
- Replace whole-conversation windows with real rolling windows once a long
  transcript exists.
- Run a local model through the same harness (`--model` accepts an Ollama id
  once a chat model is pulled) for the cost and latency comparison.
- Replace whole-conversation windows with real rolling windows once a long
  transcript exists.
