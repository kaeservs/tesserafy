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

Per criterion, the weakness is concentrated rather than spread:
`budget_indicated` 100% F1, `desired_outcome_stated` 93%, `pain_quantified`
88%, `current_process_known` 82%, **`timeline_stated` 57%** — it missed "we're
on a July renewal" and counted the seller's "renewal is in six weeks" as the
customer stating one. That is a definition to sharpen, not a model to replace.

Full method, the local-model comparison and the latency findings:
`docs/experiments/s3-criterion-detection.md`.

## Still not measured

Nothing from the phase gate. The synthesis step added in P5 has no labelled
set yet — whether an insight is the right insight is a harder thing to label
than whether a quote supports a criterion, and it needs real transcripts
before it is worth designing.
