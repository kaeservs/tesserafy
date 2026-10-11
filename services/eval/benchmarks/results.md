# Committed results

One row per run worth keeping. Numbers are only comparable within a corpus
version, and only meaningful next to the detector that produced them.

| Date | Corpus | Items | Labels | Detector | Overall P / R / F1 | Problem P / R | Feature request P / R | Paraphrase |
|---|---|---|---|---|---|---|---|---|
| 2026-09-18 | v1 (1 conversation) | 1 | 3 | `t3-extract@2026-09-17` | 50% / 67% / 57% | 50% / 50% | 50% / 100% | 0% |
| 2026-09-19 | v1 discovery-calls | 10 | 22 | `t3-extract@2026-09-17` | 79% / 100% / 88% | 70% / 100% | 100% / 100% | 0% |
| 2026-09-19 | v1 discovery-calls | 10 | 22 | `t3-extract@2026-09-19` | **95% / 91% / 93%** | 92% / 86% | 100% / 100% | 0% |

All on `claude-opus-5`. The first row measured one conversation and is kept
only to show where the harness started.

### Opus 5 against Sonnet 5 (2026-09-27, ADR 0014)

Same corpus, same extractor, `python -m harness.run … --model <id>`, two runs
each. T3 moved to Sonnet 5 on this.

| Model | Overall P / R / F1 | Problem P / R | Feature request P / R | Tokens in / out | Per call |
|---|---|---|---|---|---|
| `claude-opus-5` | 95% / 82–86% / 88–90% | 91–92% / 71–79% | 100% / 100% | 13,738 / ~3,465 | $0.0155 |
| `claude-sonnet-5` | 94–100% / 77–86% / 85–93% | 90–100% / 64–79% | 100% / 100% | 13,738 / ~3,806 | $0.0066 |

Within noise at this size (one label is four or five points); both miss
`someone always fat-fingers a column`. The Opus figures sit a few points
below the 2026-09-19 row, which is the run-to-run spread, not a change.

## What the corpus can and cannot tell you

**It is synthetic.** The transcripts and the labels were written by the same
author, so a high score means the extractor agrees with one person's reading
of invented conversations. It is a regression detector, not evidence of
quality. Real transcripts produce a v2 corpus; these numbers do not transfer
to it.

Ten conversations and twenty-two labels also means one disagreement moves a
figure by four or five points. Read movements, not decimals.

## The prompt change between rows two and three

Row two's failures were all one behaviour: the extractor split a single
problem into its facets. "On Mondays it's closer to two hours" sizes the
dispatch rebuild; "customers can't answer these questions themselves" is the
cause of the ticket volume; three of Solstice's four findings were aspects of
stalled adoption. Recall was perfect — nothing was missed, and the two
conversations that contain no signals correctly produced none.

`t3-extract@2026-09-19` adds two rules: one signal per distinct cost, with
restatements and magnitudes folded in as further evidence; and the customer's
own constraints (budget, capacity, other projects) are context rather than
problems.

Precision went 79% → 95%. Recall went 100% → 91%, and **the two new misses are
the same rule working in reverse**:

- `acme-discovery`: the labels call the Friday cost and the mistyped column two
  problems — time and accuracy. The new rule's test ("would one change resolve
  both?") says one, because automating the export fixes both.
- `helios-support`: same shape. Ticket volume and two analysts doing nothing
  else are one problem under the merge test, two under the labels.

Both extractions are defensible. What this actually surfaced is that the
corpus has no stated convention for when a cost is distinct — so that argument
now belongs in `datasets/v1/README.md`, not in a percentage.

The change was kept because for a user-facing insight list, a duplicate entry
is more damaging than a merged one: it makes the list look padded, and the
evidence behind the duplicates is the same words.

**Resisting the obvious next move:** tuning the prompt again until these two
labels pass would be fitting ten synthetic conversations, and the number would
stop meaning anything. The next real improvement is fifty labelled snippets
from spike S3.

## Criterion correctness

Measured 2026-09-19 by spike S3, which built the T1 detector this dimension
needed. Same corpus of conversations, a second labelling pass over five
discovery criteria, graded by the same span-overlap rule.

| Date | Windows | Labels | Detector | Model | Overall P / R / F1 |
|---|---|---|---|---|---|
| 2026-09-19 | 10 | 28 | `t1-detect@2026-09-19` | `claude-haiku-4-5` | 83% / 86% / 84% |
| 2026-09-23 | 10 | 28 | `discovery` v1 | `claude-haiku-4-5` | 77% / 84% / 79–81% |
| 2026-09-23 | 10 | 28 | `discovery` v2 | `claude-haiku-4-5` | 76–79% / 93% / 84–85% |

### Why the later rows are ranges

The 2026-09-19 row was measured before any tier set a temperature, so every
call sampled freely against a fixed output schema. That makes 84% one draw
from a distribution rather than a measurement — eight runs of a single window
later produced five distinct results and three different sets of criteria, one
of them empty.

The later rows were measured with `temperature: 0` pinned across every tier,
and are given as ranges because that is what repetition showed. **Temperature
zero removed most of the variance and did not remove all of it.**

    discovery v1, four runs   81%  81%  81%  79%
    discovery v2, two runs    85%  84%

An earlier note in this file claimed the pinned detector reproduced exactly,
on the strength of the first two v1 runs agreeing. A third and fourth run
disagreed. The residual variance is not spread evenly: it lands almost
entirely on `timeline_stated`, which scored 75% three times and 57% once and
is the criterion closest to a judgement call. A borderline logit can still
flip at temperature zero; the rest of the set does not move.

The practical rule that follows: quote a range, not a figure, and treat a
difference of two or three points between two single runs as nothing at all.

Read the 2026-09-19 to 2026-09-23 drop as the error bar becoming visible
rather than quality lost. Nothing about the detector changed except that it
stopped rolling dice, and per-criterion the figures moved in both directions,
which is what a single sample looks like when repetition replaces it:

| Criterion | v1, one draw | v1, repeated | v2, repeated |
|---|---|---|---|
| `budget_indicated` | 100% | 100% | 100% |
| `desired_outcome_stated` | 93% | 93% | 93% |
| `pain_quantified` | 88% | 75% | **88%** |
| `current_process_known` | 82% | 78% | **84%** |
| `timeline_stated` | 57% | 75% / 57% | **67% / 60%** |

### What v2 changed, and what it did not

v2 was written against the error modes the repeated v1 runs exposed, not
against a hunch. Three sharpenings:

* `pain_quantified` was firing on savings a change *would* produce — "would
  save me a fortnight of arguing every term" — and missing costs stated as a
  frequency. It now says the cost must be one already being paid, and that a
  frequency is a size. 75% to 88%.
* `current_process_known` was firing on processes described as a condition —
  "if the dashboard could show the lineage" — and missing terse answers like
  "we count weekly". It now distinguishes what happens now from what is
  wished for. 78% to 84%.
* `timeline_stated` was missing dates set by an event rather than a purchase
  — "he retires in November". Widening it fixed the misses and bought false
  positives instead: scheduling ("she's at a conference until Thursday"),
  past events ("the migration fixed that in March") and the seller's own
  dates. A second pass excluded those three explicitly, which restored
  precision and lost recall again.

**`timeline_stated` is unresolved.** It is the only criterion v2 leaves worse
than v1, and two attempts moved the error from one side to the other without
improving it. It is also where the residual run-to-run variance lives. With 28
labels across 10 windows, one span is worth roughly eight points of that
criterion's F1, so further tuning against this corpus would be fitting it
rather than fixing anything. It needs more labelled windows before it needs
more wording.

`timeline_stated` was the headline weakness and is no longer the worst
criterion; `pain_quantified` fell further than anything else rose. Both
readings were true of the run that produced them and neither was true of the
detector.

### What the re-run does not settle

Latency came back at p50 3313 ms, p95 4161 ms, against 2153 ms from a laptop
and 1432 ms server-side in the original spike. That is not a regression claim:
it is a different day, a different network and a laptop rather than `iad1`,
and ADR 0010 already rests on the co-located figure. It is recorded because a
number measured in passing is still a number somebody will find later.

Cache read 0 of 10 calls, which agrees with the spike: with a system prompt
and five criteria the frozen prefix is below Haiku's minimum cacheable size,
so the breakpoint buys nothing at this corpus size. Unchanged by pinning the
temperature, as expected.

What survives from the first pass is the shape of the errors rather than their
size. `timeline_stated` still counts a seller's "renewal is in six weeks" as
the customer stating a timeline, and still misses "he retires in November".
That is a definition to sharpen, not a model to replace — and
`pnpm criteria --try` now exists to sharpen it against more than one call.

Full method, the local-model comparison and the latency findings:
`docs/experiments/s3-criterion-detection.md`.

## How a stored call is windowed (2026-09-27, ADR 0014)

`spike_s3 --stride N [--window W]` scores each transcript through the
product's own path (`windowsOf` + `scanWindows`) instead of as one window, so
windowing can be graded against these labels. Criteria v1, three runs per row
unless noted.

Ten discovery calls, 28 labels:

| Windowing | Overall P / R / F1 | Tokens in / out |
|---|---|---|
| 3 utterances, stride 1 (the old product path) | 58–60% / 89–93% / 70–73% | 24,775 / ~3,660 |
| 3 utterances, stride 2 | 60–63% / 75–79% / 67–70% | 19,791 / ~2,370 |
| one window per call | 77% / 82–86% / 79–81% | 9,755 / 1,953 |
| **the product now** (48, stride 46), one run | 77% / 86% / 81% | 9,755 / 1,953 |

The same ten joined into one 47-segment call (`runs/concat`, built by a
throwaway script; not committed, because it is derived):

| Windowing | Overall P / R / F1 | Tokens in / out |
|---|---|---|
| 3 utterances, stride 1, two runs | 39–40% / 100% / 57% | 41,210 / ~6,400 |
| one window | 85% / 79% / 81% | 2,456 / 1,624 |
| **the product now**, one run | 85% / 79% / 81% | 2,456 / 1,624 |

Stride 2 lost `desired_outcome_stated` recall (100% → 57%) in every run and
was not shipped. Small windows lose precision because a sentence seen without
its conversation looks like evidence it is not; one window loses a little
recall, almost all of it on `timeline_stated` (25% recall on the long call),
which was already the weakest criterion. **Every figure here is on synthetic
calls of under ten minutes.** Label real ones before trusting the long-call
behaviour.

## Haiku 5.5 against Haiku 4.5 (2026-10-11, ADR 0030)

`claude-haiku-5-5` rejects `temperature: 0` and thinks unless told not to;
it ran with thinking off and no temperature, Haiku 4.5 at zero. Criteria v1,
ten discovery calls, 28 labels, from a laptop.

The product's stored-call path (`--stride 46`, one window per call):

| Model | Runs | Overall P / R / F1 | Latency p50 | Cache read | Tokens in / cached / out |
|---|---|---|---|---|---|
| `claude-haiku-4-5` | 3 | 77% / 86% / 81% (identical) | 2.70-2.80 s | 0 / 30 | 9,755 / 0 / 1,953 |
| `claude-haiku-5-5` | 4 | 79-84% / 89-96% / 85-89% | 2.19-2.25 s | 39 / 40 | 2,243 / ~10,500 / ~2,350 |

    Haiku 5.5, F1 over four runs   88%  85%  89%  86%

`timeline_stated` scored 100% in all four Haiku 5.5 runs, against 75%. The
spread between runs lands on `pain_quantified` (71-80%) and
`current_process_known` (78-90%).

A live call's shape (`--stride 1 --window 3`), one run each: Haiku 4.5
57% / 86% / 69%, Haiku 5.5 68% / 96% / 79%; tokens 24,775 / 0 / 3,621 against
4,001 / 28,458 / 4,345.

At published prices a stored-call run cost $0.0195 on Haiku 4.5 and about
$0.0015 on Haiku 5.5; the live-shaped run $0.043 and $0.0029. Haiku 5.5 counts
roughly a third more tokens for the same text and writes about a fifth more
output; the cache, which engages only on Haiku 5.5, more than makes up for
both, so the saving is 92-93% rather than the price's 90%.

### Extraction on Haiku 5.5 (same day, not adopted)

`python -m harness.run … --model <id>`, two runs each, the T3 corpus:

| Model | Overall P / R / F1 | Problem P / R | Feature request P / R | Tokens in / out | Per call |
|---|---|---|---|---|---|
| `claude-sonnet-5` | 94-100% / 77-82% / 85-90% | 90-100% / 64-71% | 100% / 100% | 13,738 / ~4,060 | $0.0068 |
| `claude-haiku-5-5` | 85-90% / 77-82% / 81-86% | 75-83% / 64-71% | 100% / 100% | 13,758 / ~4,470 | $0.00036 |

Same recall, a few points less precision, all of it on problems: Haiku 5.5
states a problem the label puts in different words ("credit notes are costing
them customers" where the label is "about one in twenty comes out wrong") or
quotes a neighbouring span. One label is four or five points here, so the gap
is at the edge of noise, but it is the same direction in both runs. A
twentieth of the price; T3 stays on Sonnet 5 until real transcripts can settle
it.

## Still not measured

Nothing from the phase gate. The synthesis step added in P5 has no labelled
set yet — whether an insight is the right insight is a harder thing to label
than whether a quote supports a criterion, and it needs real transcripts
before it is worth designing.
