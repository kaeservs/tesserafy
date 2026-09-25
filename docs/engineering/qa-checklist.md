# QA checklist

Run `pnpm qa` first. It checks everything a machine can judge — the auth
boundary, the API surface, and the data invariants — against production in
about ten seconds, so this session is spent on what only a person can decide.

    $env:SUPABASE_URL = 'https://nrskaekkmkeleitiljli.supabase.co'
    $env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'
    pnpm qa

Everything below is a judgement, not an assertion. Where something fails,
write down what you saw rather than a verdict: "the highlight covered the
whole sentence" is actionable, "highlighting broken" is not.

## Before you start

Sign in at `/login`. **Open the emailed link in the same browser you requested
it from** — the PKCE verifier lives in that browser, and clicking through from
a mail client that opens a different one fails with
`pkce_code_verifier_not_found`. That is a known gap with a known fix (custom
SMTP, so the email can carry a `token_hash` link instead); it is not a bug to
re-report.

## P1 — every signal links to the words behind it

**Steps 1 to 4 are now automated.** `pnpm e2e` drives a browser through every
signal on the first six conversations and asserts each quote is verbatim in
the segment it points at, carries a timestamp, scrolls into view when clicked
and is marked inside that segment. Run it rather than clicking through, and
keep the steps below for when it fails or when you want to see it yourself.

Open **Conversations → Acme Robotics — discovery call**.

| # | Do | Pass looks like |
|---|---|---|
| 1 | Read the Signals list | Each signal is a sentence about the customer, with one or more quotes under it |
| 2 | Click a quote | The page jumps to that segment in the transcript below |
| 3 | Look at the segment | It has a left border and tinted background, and the exact quoted phrase is highlighted inside it |
| 4 | Read the quote against the transcript | Word for word identical, including any awkward phrasing |
| 5 | Open **Pinegrove Clinic** and **Brightloom Retail** | **No signals.** These transcripts deliberately contain none; an empty list is the correct answer, not a failure |

Step 4 is the one that matters most. A quote that reads better than the
transcript is the failure this product cannot have.

## P5 — an insight and its evidence

Open **Insights**.

| # | Do | Pass looks like |
|---|---|---|
| 1 | Read the list | Each insight shows how many signals and how many conversations back it |
| 2 | Open the insight | Title and summary read as something a product person would act on |
| 3 | Read the evidence | At least three quotes, from at least two different conversations |
| 4 | Check each citation | Names the customer and a timestamp |
| 5 | Click a quote | Lands in that conversation's transcript, at that segment, highlighted |
| 6 | Judge the summary | Does it claim more than the quotes support? Note any sentence that goes beyond them |

Step 6 is a real test and the easiest to skim past. The product's claim is that
insights are evidenced; an insight that generalises past its evidence is a
defect even when it reads well.

## P6 — the live path

**Replay:** open a conversation → **Replay as a live scorecard** → Play.

| # | Do | Pass looks like |
|---|---|---|
| 1 | Watch the scorecard | Criteria move from `unobserved` to `candidate`/`confirmed` as relevant utterances play |
| 2 | Watch for flicker | A confirmed criterion **never** goes back to unobserved. Latching is invariant 2; a flicker here is a serious defect |
| 3 | Read the latency table | p50 and p95 for utterance → visible score. Expect ~2 s, not 1.3 s (ADR 0010) |

**Microphone:** open **Live** in the nav.

| # | Do | Pass looks like |
|---|---|---|
| 4 | Start listening, say "Exporting the weekly report takes us most of Friday afternoon" | Words appear as you speak; after you stop, a criterion lights up |
| 5 | Check speech → first partial | Should be near the 300 ms budget; note what you see |
| 6 | Say something irrelevant ("the weather is nice") | Nothing lights up. A detector that finds evidence everywhere is worse than one that finds none |

## P7 and S1 — the overlay

    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    pnpm --filter @tesserafy/desktop dev

It connects to production by default; sign in with your usual username or
email and password.

| # | Do | Pass looks like |
|---|---|---|
| 0 | Sign in, quit, start it again | Second start is already signed in; *Sign out* then brings the form back |
| 1 | Look at the overlay | Always on top, transparent edges, criteria listed, score at the top |
| 2 | Click Listen and speak | Score updates, same as the browser |
| 3 | **Share your entire screen** in Zoom | Participants do **not** see the overlay |
| 4 | **Share the meeting window** | Same |
| 5 | Toggle protection **off**, share again | Participants **do** see it. This step proves the test can detect a failure — without it, step 3 proves nothing |
| 6 | Repeat 3–5 in Meet (Chrome) and Teams | Same |
| 7 | Turn click-through on, click the meeting behind | The meeting responds |

Record the results in `docs/experiments/s1-content-protection.md`. If step 5
shows nothing, stop: the test was never valid, and steps 3–4 say nothing.

## P8 — approval and a ticket

Needs `GITHUB_TOKEN` and `GITHUB_TICKET_REPO` set in Vercel first.

| # | Do | Pass looks like |
|---|---|---|
| 1 | Open an insight | Status reads `proposed`, with Approve and Dismiss |
| 2 | Click **Approve** | Status becomes `approved`; a **Create ticket** button appears |
| 3 | Click **Create ticket** | A link to the created issue appears |
| 4 | Open the issue | Title is the insight; body carries every quote with customer, timestamp and a link back |
| 5 | Click a transcript link from inside the issue | Lands on the right segment |
| 6 | Reload and click Create ticket again | Not possible — the existing ticket is shown instead. Clicking twice must not open two issues |

## What failure looks like

Worth knowing which failures are interesting:

- **A quote that does not match the transcript** — the most serious defect
  this product can have; the whole claim rests on it.
- **A confirmed criterion reverting** — breaks invariant 2 and makes a live
  scorecard untrustworthy.
- **A signal on Pinegrove or Brightloom** — the extractor inventing findings.
- **An insight citing one conversation** — it is a signal, not an insight.
- **Latency far above ~2 s** — worth a number, not a verdict; ADR 0010 is
  based on measurements that can be re-taken.
