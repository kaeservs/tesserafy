# scripts

Operator tooling. These run server-side and hold the service-role key, which
bypasses RLS — nothing here may be imported by `apps/web`.

## `pnpm ingest <file> --company <uuid>`

One transcript, end to end: parse (WebVTT or turns-as-JSON) → chunk → embed →
write the conversation → T3 extraction → store signals with verified evidence.

`--dry-run` parses and chunks only, so a new transcript format can be checked
without a database, a model or a key. `--no-extract` stops after the
transcript is written.

Each database write is one transaction, so an interrupted run leaves a whole
conversation or nothing at all.

## `pnpm score --company <uuid>`

Gives a stored conversation a scorecard. Runs T1 over the saved segments in
the same rolling windows the live path uses, and writes the resulting
DetectorEvents to `criterion_events`.

It never writes a score. The score is computed on read by `packages/scoring`
from these rows, so re-tuning a threshold re-scores history rather than
leaving a stored number that no function would now produce.

Windows overlap deliberately — a criterion is often established across two
utterances, a complaint in one and its cost in the next — and the same span
observed twice is stored once.

`--conversation <uuid>` does one. `--rescore` includes conversations that
already have events. `--dry-run` prints the detector call count and sends
nothing, which is the only way to see the bill before paying it.

## `pnpm process --conversation <uuid>`

What happens to a call after it ends: embed its stored segments, then run T3
extraction over them and store the signals.

`pnpm ingest` does both as part of importing a file. A live call never went
through it — its segments arrived one at a time while somebody was talking, so
nothing embedded them and nothing extracted from them. The effect was quiet
and total: a live call scored and appeared on the dashboard, and could never
become an insight, because insights are clustered from signals through a
vector search and it had neither.

Deliberately not automatic. T3 is Opus and an insight is a claim about a
customer, so spending that without a person asking is what "no auto-creation
anywhere" rules out.

`--company <uuid>` does every conversation missing either. `--embed-only`
skips extraction. `--dry-run` prints the plan and pays none of it.

Extraction is skipped once it has an answer, **including an empty one**. A
check-in where the customer says everything is fine has no signals and never
will; treating that as pending would re-run Opus over it on every pass to
reconfirm a zero. Whether the pass has run comes from the usage telemetry,
which records the conversation each model call was made against.

`--force` re-extracts regardless, which is how a prompt change gets applied to
a corpus that has already been processed.

## `pnpm criteria --add <file.json>`

Publishes a criteria set. "A new engagement type is a row" has been the stated
convention since the table was written, and until now there was no way to
write the row: the only set that existed was the one shipped in its migration,
and every live surface hardcoded its name.

An operator script rather than a migration, which the criteria migration
itself anticipated — schema goes through migrations, a renewal criteria set
does not. Not a browser feature either: `criteria_definitions` has no write
policy on purpose, because a criteria set decides what every scorecard in the
product means and a customer editing one mid-quarter silently re-scores their
own history.

Every set is validated by `defineCriteriaSet()` — the same function the loader
uses — before anything is written, so a file with impossible thresholds fails
at the terminal rather than at load time in front of somebody on a call.

A published version is immutable. Conversations pin the version they were
scored against, so editing one in place would re-score history nobody asked to
have re-scored. Publish the next version instead.

`--list` shows what exists, `--show <type>` prints a set in full, `--dry-run`
validates without writing.

## `pnpm insights --company <uuid>`

Clusters a company's signals through the guarded retrieval path, asks T3
whether each cluster is one finding, and writes those that are.

Signals that already back an insight are left out, so running this twice does
not write the same finding twice. Clustering is deterministic over unchanged
data: without the exclusion a second run re-derives a finding that exists,
pays for the same Opus call, and leaves a person two near-identical insights
to approve.

The tradeoff, stated plainly: a new signal that belongs to an existing insight
does not join it — it waits until enough new signals accumulate to cluster on
their own. Growing an insight means re-opening a claim somebody may already
have approved and raised a ticket from, which is a larger decision than a
batch script should make on its own.

`--resynthesise` includes cited signals, which is what you want after changing
the synthesis prompt and nothing else. `--dry-run` clusters and prints without
calling a model or writing anything.

### `pnpm criteria --try <file.json> --conversation <uuid>`

Runs a candidate criteria set over a real conversation and writes nothing.

A criterion definition is a prompt. Publishing one without ever running it is
shipping a prompt blind: the set validates, the thresholds are sane, and it
can still detect nothing at all because the wording does not describe anything
a customer says out loud.

The first thing this found was a fault in the `renewal` set shipped beside it.
`renewal_risk_named` listed its examples — budget review, competitor, sponsor
leaving, complaint — and detected nothing in a call where the customer said
only the data desk was using it and the team was heads-down until Q3. Both are
renewal risks; neither was on the list. Broadening the wording to name the
shape of the thing rather than four instances of it took the same conversation
from 27 to 55.

Against a conversation already in the database, so what comes back is what the
live path would see rather than what an invented example invites. The calls
are recorded in `model_usage` like any other: a trial costs money, and
telemetry that skipped the experiments would understate what getting a
criteria set right actually took.

Several conversations by default, because one is the wrong number. A
definition tuned until one transcript lights up has learned that transcript.
`--company <uuid> [--sample 5]` runs the set across recent calls and reports,
per criterion, in how many it confirmed — which is the question that matters.
`--conversation <uuid>` still does one.

It says what it was tried against. A renewal set run over discovery calls
tells you how the wording behaves on the wrong material: a criterion that
never fires may be perfectly right, and one that fires everywhere is probably
matching something it was not meant to. Neither reading is safe without
knowing what the sample was, so the engagement type of each conversation is
printed and a mismatch is called out.

Two things to keep in mind when reading a run. The detector is not
deterministic — the same set over the same three conversations produced scores
of 45 and 18 for one of them across two runs — so treat a single number as an
indication and a pattern across conversations as the finding. And a criterion
confirming everywhere is as much a signal as one confirming nowhere: on
discovery calls, a renewal set's "value realised" confirmed against a
description of current manual work, which is a false positive the single
conversation view could not have shown.
