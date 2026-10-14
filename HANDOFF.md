# Handoff — start here

For any Claude session on this project, on the web (claude.ai/code), in the
app, or locally. `CLAUDE.md` holds the architecture, the invariants and the
rules; this file holds the rest:

- how the owner works with Claude;
- where things stand;
- what is waiting on the owner.

Until 2026-10-14 this lived in one machine's local memory. The repository is
the only memory a cloud session has, so **keep the last two sections current**:
updating them is the last step of any piece of work.

Nothing secret goes here or anywhere in the repository, which is public: no
keys, passwords, tokens, internal addresses or unfixed weaknesses. Those live
in `.env`, in Vercel's and GitHub's secrets, and with the owner.

## What Tesserafy is

Conversation intelligence for sales calls, with two surfaces.

**The overlay** (`apps/desktop`, Electron) sits over a live meeting. It is
Cluely-like:
- it shows what to say next and a scorecard that fills itself in with quoted evidence;
- it has four buttons: Assist, What should I say?, Follow-up questions and Recap;
- it has an ask box, which can read the screen;
- it hears both sides of the call.

**The dashboard** (`apps/web`, Next.js on Vercel) holds every control:
scorecards, preps, the knowledge base, call pages, follow-up emails,
insights, reports, plans and billing.

**The operator console** (`apps/admin`) is a separate deployment: the only
place the Supabase service-role key exists.

The data lives in Supabase (Postgres with RLS, pgvector, an edge function for
embeddings). Models are Claude: Haiku 5.5 for scoring, Sonnet 5 for
everything else. Deepgram transcribes live calls.

## Product direction (owner, 2026-10-04 and since)

- **Parity with Cluely's overlay is the top priority.** Say so whenever the
  build drifts from it. Cluely's in-call surface is the target:
  - Hide, Stop, and "Ask about your screen or conversation";
  - Assist (Ctrl/Cmd+Enter), What should I say?, Follow-up questions and Recap;
  - both sides heard, the screen read, answers from the company's documents;
  - works over Zoom, Meet and Teams, in the browser too, because it is a
    window and never a bot.
- **Undetectable in the meeting, never on the computer.**
  - In the meeting: no bot joins, nothing announces it, and on the Incognito
    plan it is excluded from screen sharing. It is also off the taskbar,
    Alt-Tab and the Dock.
  - On the computer: the process keeps its own name, and nothing evades
    monitoring or proctoring software.
- **Consent is the user's legal responsibility,** agreed to once and kept as
  a record (ADR 0020). Call audio and transcripts are never used for
  Tesserafy's own purposes.
- **Minimal controls on the overlay; everything else in the dashboard.** The
  dashboard is where Tesserafy is ahead of Cluely:
  - evidence-backed scoring and coaching;
  - insights, action items and follow-ups;
  - researched preps;
  - an AI that learns from corrections.
- **The landing page's overlay demo** is the real overlay drawn 1:1. A change
  to one is a change to the other.

## How the owner works with Claude

- **An apprenticeship.** For a decision that matters architecturally, explain
  the problem, the options, the recommendation and the tradeoff before
  building. Trivial syntax needs no explanation.
- **End every piece of work with the full list of what is waiting on the
  owner.**
  - It applies to every finished PR, check, status update and "what's next"
    answer.
  - Use a bulleted list, one line per item, with a bold label.
  - Rebuild it from what is actually open, using the section below.
  - The owner asked for this ("always remind me of my pending after every
    run") and confirmed the format.
- **Keep reminding about live transcription** until a real call has been
  transcribed (see below).
- **Pull requests:**
  1. Branch `pNNN/<slug>` from `main`, numbering on from the last.
  2. Open the PR as a draft.
  3. Wait for CI.
  4. Mark it ready.
  5. The owner merges, sometimes opening or merging from a pushed branch
     themselves, so check whether a PR already exists or the branch is
     already in `main`.
  - Commit messages explain why, in the house style; look at `git log`.
  - Locally, PRs go through the GitHub REST API with a token from `.env`.
    Don't ask the owner to reconfigure tools that already work.
- **When the owner says "PR merged":**
  1. Check CI on `main`.
  2. Run `pnpm qa --url <production>`.
  3. Run `pnpm e2e` with `E2E_BASE_URL` and `ADMIN_BASE_URL` set to
     production.
  4. Run `pnpm health`.
  5. Build the next item.
  - The production addresses and credentials are in `.env`.
- **Anything that spends model money** (evals, probes, comparisons) gets the
  owner's OK first, with its estimated cost. Changing a tier's model happens
  only against `services/eval`, over several runs.
- **Database changes go through `supabase/migrations/` only:**
  - apply with `supabase db push`, then run `pnpm db:types`;
  - read-only SQL is for audits, never for changes.
- **Overlay releases:** bump `apps/desktop/package.json`. The owner pushes
  the tag `overlay-vX.Y.Z`, which must match that version; the workflow then
  builds the installers.
- **Key rotations are deferred until launch,** by the owner's choice. The
  leaked e2e password below is the exception.
- **Don't:**
  - touch the "QGR …" workflows on the owner's n8n (another project);
  - generate media without a clear yes;
  - read Paragon / AI Paragon files.

## Where things stand (2026-10-14)

**Recently merged**
- **#205:** the criterion detector runs on Haiku 5.5. About 90% cheaper and
  more accurate (ADR 0030).
- **#206:** Free is a trial, given once: one meeting of up to fifteen
  minutes. ADR 0031 also has what a seat costs at full use on each plan.
- **#207:**
  - fixes from the 2026-10-12 security review;
  - every AI path now spends an allowance;
  - the e2e password is out of the files.
  - The open items are in `docs/engineering/security-review-2026-10-12.md`.

**Models**
- T1 scoring: Haiku 5.5.
- T2/T3: Sonnet 5.
- **Proposed:** move Ask your calls and live suggestions to Haiku 5.5, which
  would save about $3 on a fully used Pro seat. It waits on the owner's OK
  for a ~25¢ comparison.
- Extraction was measured on Haiku 5.5 (81–86% against Sonnet's 85–90%) and
  stays on Sonnet.

**Plans**
- Free: a one-time trial.
- Starter, Pro and Incognito: $9.99, $19.99 and $59.99 a seat.
- At full use the margins are about 64%, 51% and 81%. Live minutes
  (Deepgram) and Ask questions (Sonnet) decide what Pro costs.

**Payments:** Dodo Payments instead of Stripe for now.
- The owner is setting it up and will share the details.
- Don't build the switch until then.
- The current code is Stripe (ADR 0025). The switch needs an ADR that keeps
  that design: the webhook verified in the database, a paid plan only at
  checkout, seats from the subscription.

**Live transcription** is built (Deepgram, both sides; ADR 0022), but off in
production.
- The key was added to the console's Vercel project, not the web app's.
- `pnpm qa` checks it with the line "Deepgram grants the overlay a token".

**The overlay:** 0.1.25 is the latest release. The Mac test and the S1
screen-share check are not done yet.

**Sign-up** is closed until email (Resend) works and payments are live.

## Waiting on the owner

- **Rotate the e2e account's password.** It was committed to this public repo
  and stays in history. Set the new one in Actions secrets (`E2E_PASSWORD`)
  and in `.env`.
- **Decide whether the repository stays public.**
- **Live transcription:**
  - put `DEEPGRAM_API_KEY` on the web app's Vercel project (Production),
    redeploy, and remove it from the console's;
  - ask Deepgram (security@deepgram.com) for their GDPR data processing
    addendum;
  - switch Deepgram's auto-reload off or keep the balance small, because
    the balance is the only hard cap;
  - then make a first real call.
- **Haiku 5.5 for Ask and suggestions:** OK for the ~25¢ comparison?
- **Dodo Payments:** set it up and share the details. Open sign-up only once
  payments are live.
- **Supabase:** turn on leaked-password protection.
- **Anthropic Console:** a monthly spend limit, with auto-reload.
- **Resend:** set it up, then open sign-up. The follow-up "send" has an open
  item to fix first; see the security review.
- **Overlay 0.1.25:** the Mac test and the S1 screen-share check.
- **Ops alerts:** attach the credential and a chat node to "Tesserafy ops
  alerts" in n8n, then publish it.
- **Legal:** the Terms page and `TERMS_URL`.
- **Code signing:** the certificates, and the country the company is
  registered in.
- **Calendar:** register the Google and Microsoft OAuth apps.
- **HubSpot:** `CRM_TOKEN_KEY`.
- **Call-prep research:** `APIFY_TOKEN`.
- **Other key rotations, at launch:** the GitHub token, operator MFA, the n8n
  MCP key.
- **Zoom app.**
- **Real transcripts,** and a decision on the two proposed insights.
- **Skipped for now, at the owner's word:** trackers (`TRACKER_TOKEN_KEY`) and
  the n8n server's own setup.

## What is not in the repository

| What | Where | In a cloud session |
|---|---|---|
| Keys and passwords (`.env`) | The owner's machine; Vercel and GitHub secrets | Add only what the task needs as environment variables. Production scripts (`qa`, `e2e`, `health`, `db push`) need the privileged ones, so they may be better run locally. |
| The n8n instance and its MCP access | The owner's own server and connectors | Add it as a connector if the task needs n8n |
| Supabase access | The claude.ai Supabase connector the owner set up | Use that connector, as CLAUDE.md says |
| Running the overlay, screenshots of it | A real desktop | Not possible in the cloud: ask the owner, or do it locally |
| Release tags | The owner | Always the owner |
