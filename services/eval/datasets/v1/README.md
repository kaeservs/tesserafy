# v1 — discovery calls

Synthetic while real transcripts are unavailable. Every item says so in its
`id` or its transcript header; when real calls arrive they go in a v2 corpus
rather than mixing with these, so a number can always be traced to the kind of
data it was measured on.

## Labelling rules

A label is a claim that a competent reader of this transcript would extract
this signal, evidenced by this quote.

1. **Quote the transcript exactly.** The harness locates each quote and
   refuses to load a label it cannot find, or one that matches more than one
   segment. Extend a short quote until it is unique rather than adding offsets.
2. **Quote the evidence, not the conclusion.** The span should be the words a
   reader would point at, because that is what the extractor is graded on.
3. **One label per distinct signal.** "It takes all Friday" and "someone
   mistypes a column" are two problems — time and accuracy — even in one
   sentence. Two labels in the same sentence are fine; they are matched by
   span overlap, not by sentence.
4. **Label what was said, not what was meant.** If the customer never asks for
   it, it is not a feature request, however obvious the need.
5. **`note` is for the next labeller**, not the harness. Say why this is a
   signal, especially for the close calls — that is what keeps a corpus
   consistent as it grows past one person.

## When is a cost distinct?

The rule that most often decides a label, and the one the corpus and the
extractor have disagreed on: *two costs are one signal when a single change
would resolve both.*

The Friday export and the mistyped column in `acme-discovery` are labelled as
two problems — time and accuracy — because a reader would act on them
differently. `t3-extract@2026-09-19` merges them, since automating the export
fixes both, and that disagreement is why row three of `benchmarks/results.md`
shows 91% recall rather than 100%.

Neither reading is wrong. The convention here is: **label the costs a reader
would act on separately, even when one change would fix both.** If that proves
to be the wrong call as real transcripts arrive, change it here first, then
re-measure — do not quietly relabel to make a number move.

## Known gaps

Three labels over one conversation is far too small to draw conclusions from.
It exists so the harness is exercised end to end and the labelling rules are
written down before volume arrives. Spike S3 produces the first fifty labelled
snippets.
