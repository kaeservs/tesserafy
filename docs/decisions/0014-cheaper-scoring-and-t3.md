# 0014 — Scoring a stored call in large windows; T3 on Sonnet 5

**Status:** proposed · 2026-09-27 · amends ADR 0002's model routing

## Context

The owner asked whether the AI could cost less. Production's own usage log
(`model_usage`, 241 calls, $0.59 in total) put a price on each step at today's
rates (Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per million tokens in
and out, confirmed from the pricing page on 2026-09-27):

| Step | Model | Per call |
|---|---|---|
| Scoring, per detector call | Haiku 4.5 | $0.0015 |
| "Find insights in this call" | Opus 5 | $0.012 |
| "Look for patterns", per write-up | Opus 5 | $0.02 |

Those are short synthetic calls. What decides the bill on real ones is how
scoring was cut up: a three-utterance window advancing one utterance at a
time, so **one Haiku call per utterance**. An hour-long meeting is ~500
utterances, ~500 calls and up to ~$0.95 to score, which `score-upload.ts`
already recorded when it set its limits. Basic allows ten imports a month at
$9; ten hour-long meetings would have cost more to score than the plan
brings in. Scoring is already on the cheapest current Claude model, so no
change of model could fix it. The number of calls could.

## What was measured

All with the evaluation harness in `services/eval`, graded by span overlap
against the labelled sets. Each configuration ran more than once, because a
single run at temperature zero still varies by a few points
(`benchmarks/results.md`).

**Scoring — criteria labels, ten discovery calls (28 labels):**

| Windowing | Precision | Recall | F1 | Tokens in / out |
|---|---|---|---|---|
| 3 utterances, stride 1 (old), 3 runs | 58–60% | 89–93% | 70–73% | 24,775 / ~3,660 |
| 3 utterances, stride 2, 3 runs | 60–63% | 75–79% | 67–70% | 19,791 / ~2,370 |
| One window per call, 3 runs | 77% | 82–86% | 79–81% | 9,755 / 1,953 |

**Scoring — the ten calls joined into one 47-segment call** (the corpus has
no long call; joined, it is ten times longer than any in it, and harder than a
real one because the subject changes every minute):

| Windowing | Precision | Recall | F1 | Tokens in / out | Cost |
|---|---|---|---|---|---|
| 3 utterances, stride 1 (old), 2 runs | 39–40% | 100% | 57% | 41,210 / ~6,400 | $0.073 |
| One window, 3 runs | 85% | 79% | 81% | 2,456 / 1,624 | $0.011 |

A three-utterance window sees a sentence without the conversation around it,
and claims criteria the conversation does not support. On the long call six
in ten of its claims were wrong, and criteria latch, so each wrong claim
stays in the seller's score. One window gives up some recall, mostly on
`timeline_stated`, which was already the weakest criterion and the one where
run-to-run variance lives, for claims that are right five times in six.

The stride-2 variant, the cheap halfway house, lost recall on
`desired_outcome_stated` (100% to 57%, the same in every run) and was rejected.

**Extraction — ten discovery calls (22 labels):**

| Model | Precision | Recall | F1 | Per call |
|---|---|---|---|---|
| Opus 5, 2 runs | 95% | 82–86% | 88–90% | $0.0155 |
| Sonnet 5, 2 runs | 94–100% | 77–86% | 85–93% | $0.0066 |

Within noise: one label is worth four or five points here. Both miss the same
hard label.

**Synthesis** has no labelled set. On production's two clusters both models
reached the same verdicts, the one real finding written from the same four
signals and the false cluster of unrelated feature requests declined, at
$0.032 for Opus and $0.018 for Sonnet.

## Decision

1. **A stored call is scored in windows of 48 utterances, neighbours sharing
   two** (`SCORE_WINDOW_SIZE`, `SCORE_STRIDE`), with room for 8,192 output
   tokens per window. A call of up to 48 utterances is one window, which is
   what was measured; 48 is the longest window measured, so a longer call is
   cut rather than sent whole. Two shared utterances keep a complaint and its
   cost in the next utterance together at every boundary. An hour-long
   meeting is ~11 calls instead of ~500.
2. **The live path does not change.** It scores the last three utterances as
   they are spoken, because there a score must move after every sentence.
   Its cost belongs to the live-transcription work and should be designed
   there.
3. **T3 extraction and synthesis move to `claude-sonnet-5`.** Opus is a model
   id away (`--model` on `pnpm extract`, `pnpm insights`, and the harness) for
   a measurement that wants it.
4. The automatic-scoring ceiling becomes 40 windows (~1,840 utterances, about
   three hours), five rounds of eight parallel calls, inside the route's time
   budget, at a worst case of ~$0.45. Extraction keeps sharing the ceiling.

## Consequences

- Scoring an hour-long meeting drops from up to ~$0.95 to about $0.05–0.12,
  and from ~190 s to ~30 s.
- Extraction and synthesis cost roughly 45–60% less.
- **Not yet measured on a real call.** Every labelled transcript is synthetic
  and short. The first real transcripts should be labelled and run through
  `spike_s3 --stride 46` before anyone relies on the long-call numbers.
- Calls already scored keep their events; `pnpm score --rescore` redoes one
  with the new windows.
- A window is now a ~16 s call rather than ~2 s, which is why the upload path
  runs eight at once.

## Alternatives

- **Stride 2 on the old window.** Measured above: loses recall for a 20–50%
  saving.
- **Another provider's cheaper model.** Possibly cheaper per token, but it
  leaves one call per utterance in place, sends meeting content to a new
  vendor, and needs every prompt and the verbatim-quote rule re-validated.
- **Haiku for T3.** A further halving on steps that are now cents a month per
  company, on the output customers read. Not worth the quality risk.
- **The Batch API for import scoring.** Half price again, but scores would
  arrive minutes later. Still open, and it stacks with this.
