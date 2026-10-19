# Handoff — start here

Everything a Claude session needs to pick this project up, whether it runs
on the web (claude.ai/code), in the Claude app, or on the owner's machine.
`CLAUDE.md` holds the architecture, the invariants and the coding rules. This
file holds the rest:

- what we are building;
- what exists;
- how the owner works;
- where things stand;
- what waits on the owner;
- what cannot come with you.

Until 2026-10-14 most of this lived in one machine's local memory. The
repository is the only memory a cloud session has, so **keeping "Where things
stand" and "Waiting on the owner" current is the last step of any piece of
work**.

The repository is public, so nothing secret goes here or anywhere in it: no
keys, passwords, tokens or internal addresses. Those live in `.env`, in
Vercel's and GitHub's secrets, and with the owner. Work still to do on
security is named in general terms only.

**Contents**

1. What we are building
2. What exists today
3. How the owner works with Claude
4. Where things stand
5. Waiting on the owner
6. What is next
7. What cannot carry over, and how to work without it
8. Infrastructure, by name
9. Decisions
10. History
11. Glossary

---

## 1. What we are building

**Tesserafy is conversation intelligence for people who sell:** an AI that
sits beside a live sales call and helps the seller in the moment. Afterwards
it turns calls into evidence-backed coaching, follow-ups and product insights.
The headline: *"Know what to say next — on every call."*

### The problem

A seller on a call has to listen, steer and remember what to ask, all at
once, and finds out only afterwards what they missed. A manager learns what
happened on calls only by listening back. Product teams hear what customers
need second-hand, with no proof.

### The two surfaces

**The overlay** is a desktop app for Windows and Mac (`apps/desktop`,
Electron). It sits over Zoom, Meet or Teams, in the app or the browser, as a
window rather than a bot. It is modelled on Cluely, and **staying level with
Cluely's in-call experience is the owner's top priority**: say so whenever
the build drifts. Cluely's surface is the target:

- Hide, Stop, and "Ask about your screen or conversation";
- four one-press actions: Assist (Ctrl/Cmd+Enter), What should I say?,
  Follow-up questions and Recap;
- it hears both sides, reads the screen, and answers from the company's own
  documents.

On top of that, Tesserafy shows a scorecard that fills itself in as the
customer speaks. Each tick is linked to the words that earned it.

**The dashboard** is the web app (`apps/web`, Next.js). It holds every
control, while the overlay stays minimal. It also holds everything before and
after a call, which is where Tesserafy is ahead of Cluely:

- preparation and research;
- evidence-backed scoring;
- coaching and team reports;
- follow-up emails and action items;
- product insights with proof;
- an AI that learns from the company's corrections.

**The operator console** (`apps/admin`) is Tesserafy staff's own tool,
deployed separately because it alone holds the database's service-role key.

### Principles that are not up for trade

- **The model never produces a score.** Detectors return quoted evidence, and
  arithmetic turns it into a score. **No insight without evidence:** every
  claim links to a quote with a timestamp, and a paraphrase is a bug.
- **Undetectable in the meeting, never on the computer.**
  - In the meeting: no bot joins, nothing announces it, and on the Incognito
    plan it is excluded from screen sharing. It is off the taskbar, Alt-Tab
    and the Dock.
  - On the computer: the process keeps its own name, and nothing evades
    monitoring or proctoring software.
- **Consent is the user's legal responsibility.** They agree once, and the
  record is kept (ADR 0020). **Call audio and transcripts are never used for
  Tesserafy's own purposes,** such as training.
- **Privacy by construction:**
  - contact details are masked before anything is stored;
  - every query is scoped to one company;
  - embeddings run inside our own database;
  - exports and deletion are always free.
- **Measured, not guessed.** A model or windowing change is made against the
  evaluation harness, over several runs, and its cost is logged on every call.

### Business model

Plans per seat:
- **Free:** a one-time trial of one meeting of up to fifteen minutes.
- **Starter:** $9.99 a seat.
- **Pro:** $19.99 a seat.
- **Incognito:** $59.99 a seat, the plan whose overlay hides from screen
  sharing.

Each plan is a monthly allowance of imported calls, call reads, pattern runs,
questions and live minutes. ADR 0031 works out what a seat costs at full use:
margins of about 64%, 51% and 81%. Payments will go through Dodo Payments
(see section 4).

## 2. What exists today

**Status key**
- **Live:** works in production.
- **Built, off:** waits on an owner step, listed in section 5.
- **Not built.**

### The overlay (latest release 0.1.25)

| Feature | Status |
|---|---|
| A live scorecard: Haiku 5.5 reads each customer line; criteria latch, so they never flicker | Live |
| What to say next, in large type: the live suggestion, else the prep's next unanswered question | Live |
| Assist, What should I say?, Follow-up questions, Recap and an ask box; answers stream point by point, each quoting the call | Live |
| Ask about your screen: one screenshot on a press, never stored; owners can switch it off | Live |
| Answers from the company's own documents (Knowledge), quoted and named | Live |
| Before a call: the next meeting from the calendar, the prep's brief, and "Ask your calls" | Live (the calendar is built but off) |
| Hearing both sides through Deepgram (microphone = seller, system sound = customer) | Built, off: the key is not yet on the web app. Without it the overlay hears the microphone only, through the browser engine. |
| A talk-time nudge, captions, each side's share of the words | Live |
| Hidden from screen sharing (Incognito plan) | Live; S1 not yet run on real meetings |
| Out of the taskbar, Alt-Tab, the Dock and Mission Control | Live |
| Noticing a call starting: Windows from the registry, Mac 14.2+ through a Swift helper | Live; the Mac side is untested on a real Mac |
| Look (Glass at 55% by default) and settings come from the dashboard | Live |
| Stops 15 s after the meeting app lets go of the microphone; stops after four hours | Live |
| Update notice linking to GitHub Releases | Live |

### The dashboard

| Area | What is there | Status |
|---|---|---|
| **Home** | Recent calls, follow-ups to send, upcoming meetings, the plan | Live |
| **Calls** | Meetings (filters, bulk actions), This week, Live (a microphone in the browser), Search | Live |
| **A call's page** | Transcript; the scorecard with each quote; "This score is wrong"; notes; outcome; action items | Live |
| | The follow-up email on its own page: drafted live, sent once Resend is set | Draft live; send built, off |
| | Log to HubSpot | Built, off |
| **Import** | Import a transcript (VTT, SRT and more), scored on arrival; a free sample call | Live |
| **Ask** | "Ask your calls": an agent over every call, every answer quoted and linked | Live |
| **Prepare** | Call preps with a brief and questions | Live |
| | Web/LinkedIn research for preps | Built, off |
| | Customers, each with its story across calls | Live |
| **Insights** | "Find insights in this call", "Look for patterns", proposed insights with evidence | Live |
| | Tickets to GitHub, Jira or Linear | Built, off: skipped for now |
| **Team** | Reports (rep-by-criterion heatmap, trends), Coaching (assign a moment), Examples | Live |
| **Setup** | Get the overlay, Scorecards (a company's own, tried before publishing), AI guidance, Knowledge | Live |
| | Settings: plan and billing, team, calls, integrations, data/export/retention | Live, except payments |
| **Your account** | Name and password, overlay look and call detection, delete account | Live |
| | Calendar (Google/Microsoft, read-only) | Built, off |
| **Plans** | Allowances enforced in the database; a 402 names the plan page; plan announcements; three first-run steps | Live |
| | Payments | Stripe built; moving to Dodo |
| **Landing page** | Hero, the overlay demo drawn 1:1 with the real overlay, features, pricing, FAQ (the early-access form was removed in landing v2; the console still lists past requests) | Live |
| **Sign-up** | Self-serve | Built, closed until email and payments work |

### The operator console

| Feature | Status |
|---|---|
| Companies, users, plans | Live |
| Support sessions as a user: recorded, with a reason and a time limit | Live |
| Creating and deleting accounts, each recorded first | Live |
| Failures, alerts token, recording agreements, early-access requests, operator activity, spend and adoption | Live |
| Payment settings | Live (for Stripe) |
| Operator two-step sign-in | Built; the owner has not enrolled |

### Behind both

- **Database:** Supabase Postgres with row-level security on every table.
- **Embeddings:** gte-small inside Supabase.
- **Limits:** rate limits and plan allowances counted in Postgres.
- **Failures:** every failure recorded; `pnpm health` runs every four hours in
  GitHub Actions.
- **Ops alerts:** an n8n digest for a chat app, built but not switched on.
- **Cost:** model usage logged on every call (`pnpm costs`).
- **Evaluation harness:** `services/eval`.
- **Checks against production:** `pnpm qa` (95 checks) and `pnpm e2e`
  (34 browser tests).

## 3. How the owner works with Claude

- **An apprenticeship.** For a decision that matters architecturally, explain
  the problem, the options, the recommendation and the tradeoff before
  building. Trivial syntax needs no explanation.
- **End every piece of work with the full list of what is waiting on the
  owner.**
  - It applies to every finished PR, check, status update and "what's next"
    answer.
  - Use a bulleted list, one line per item, with a bold label.
  - Rebuild it from section 5, and keep section 5 true.
  - The owner asked for this ("always remind me of my pending after every
    run") and confirmed the format.
- **Keep reminding about live transcription** until a real call has been
  transcribed.
- **Pull requests:**
  1. Branch `pNNN/<slug>` from `main`, numbering on from the last (the last
     was `p173`). A cloud session may be handed a branch name of its own
     (`claude/…`); then that branch is the one to use.
  2. Open the PR as a draft.
  3. Wait for CI.
  4. Mark it ready.
  5. The owner merges, sometimes opening or merging a pushed branch
     themselves, so check whether a PR already exists or the branch is
     already in `main`.
  - Commit messages explain why; look at `git log` for the house style.
  - Every commit and PR ends with Claude's attribution line.
- **When the owner says "PR merged":**
  1. Check CI on `main`.
  2. Run `pnpm qa --url <production>`.
  3. Run `pnpm e2e` with `E2E_BASE_URL` and `ADMIN_BASE_URL` set to
     production.
  4. Run `pnpm health`.
  5. Build the next item.
  - These need the production keys (section 7).
- **Model money.** Anything that spends it (evals, probes, comparisons) gets
  the owner's OK first, with an estimated cost. A tier changes model only
  against `services/eval`, over several runs.
- **The database changes only through `supabase/migrations/`:**
  - apply with `supabase db push`, then run `pnpm db:types`;
  - read-only SQL is for audits, never for changes.
- **Overlay releases:** bump `apps/desktop/package.json`. The owner releases
  `overlay-vX.Y.Z`, which must match that version, in either of two ways:
  - on GitHub's website: Releases → Draft a new release → tag
    `overlay-vX.Y.Z`, "Create new tag on publish", target `main` → Publish.
    The workflow attaches the installers about five minutes later;
  - from a terminal: push the tag, and the workflow creates the release.
  A cloud session cannot push a tag (the session's git access is refused with
  a 403 for anything but its own branch), so the release is the owner's.
- **Key rotations are deferred until launch,** by the owner's choice. The
  leaked e2e password is the exception.
- **Don't:**
  - ask the owner to reconfigure tools that already work;
  - touch the "QGR …" workflows on the owner's n8n (another project);
  - generate media without a clear yes;
  - read Paragon / AI Paragon files.
- **Tests never send a real screen to the model;** use a rendered slide.

## 4. Where things stand (2026-10-19)

**Merged 2026-10-16: [kaeservs/tesserafy#209](https://github.com/kaeservs/tesserafy/pull/209)**, fixes from a full read of the
project (2026-10-14), every one traced in the code first:
- **Production bugs:**
  - a WebVTT pattern that 63 characters could hang;
  - Find insights hidden after action items or a follow-up;
  - long calls read only to their first 1,000 lines.
- **Telemetry:**
  - unparsable model replies now record their usage;
  - failure and usage rows are kept alive past the response.
- **Security:**
  - a row across tenants alarms at once (`tenant_boundary`), and the Ask
    agent stops on one;
  - a support visit cannot set a password;
  - the export reads only the exporter's company;
  - `pnpm ingest:batch` redacts.
- **Scoring:** a correction quoting other words of the same moment counts
  (ADR 0006 addendum).
- **Overlay (0.1.26):**
  - a sign-in survives no network;
  - each call keeps its own record;
  - Start says why it failed;
  - the screenshot greys out the overlay.
- **Smaller:**
  - charges and refunds;
  - the console's seat-blind health page;
  - erasure lists CRM notes;
  - leaving a company takes its calendar;
  - `pnpm support` takes a second-step code;
  - stale copy and docs.

Its migration `20261102090000_read_through_fixes.sql` is not applied yet:
it needs `supabase db push` and `pnpm db:types`. Until then production runs
the new code on the old schema. A sign-in-link session cannot set a password
(the check fails closed without `in_support_session()`), a `tenant_boundary`
failure row is refused by the old kind constraint, and Find insights still
hides after action items. Every check was run locally against a
Supabase stack:
- unit tests;
- pgTAP, 905 assertions;
- integration;
- both production builds.

**Also in #209, now live: the landing demo's new layout,** tried there
before the overlay at the owner's word:
- what to say is a conversation: the customer's line on the right, the words
  to say on the left, the same size as theirs (semibold, in the accent), with
  no advice about saying them;
- three buttons, AI Assist, To Ask and Recap ("What should I say?" is gone:
  the conversation already says it);
- an answer replaces what to say until closed, so there is one place to read;
- the demo no longer runs under How it looks at laptop widths (1080–1330 px).

**Merged 2026-10-16: [kaeservs/tesserafy#210](https://github.com/kaeservs/tesserafy/pull/210), the overlay follows
the demo, and both keep each button's last answer.** The owner approved the
demo and asked for both:
- the overlay (0.1.27) has the same conversation layout and three buttons;
  AI Assist asks the `say` mode, To Ask puts the prep's open questions before
  `followups` and asks the model only when the prep leaves room, and Recap is
  `recap`;
- the prompts did not change: `say`, `followups` and live suggestions already
  answer in the seller's words, quoting the line they answer. So no probe was
  needed. `assist` stays in the API for older overlays;
- each button's last answer in a call is kept (`answers.ts`). Going back to
  one shows it with how long ago it was written and spends nothing; pressing
  the one on screen, or Refresh, asks again. A new call forgets them;
- the demo does the same, on the sample call's clock.

Checked in a browser against the overlay's real page with Electron's side
stubbed: going back to a kept answer made no request. Not checked in Electron
itself or against the live API; the Mac and Windows installers come from the
tag.

**Recently merged**
- **#205:** scoring runs on Haiku 5.5. About 90% cheaper and more accurate
  (ADR 0030).
- **#206:** Free is a one-time trial (ADR 0031, which also has the per-seat
  cost of every plan).
- **#207:** the 2026-10-12 security review:
  - every AI path now spends an allowance;
  - CI publishes nothing sensitive;
  - the e2e password is out of the files.
  - The open items are in `docs/engineering/security-review-2026-10-12.md`.
- **After #206 and #207:**
  - CI on main is green;
  - e2e passes 34/34 and health is clean;
  - QA passes 94/95. The one failure is Deepgram (below).

**Models**
- Scoring: Haiku 5.5.
- Everything else: Sonnet 5.
- **Proposed:** Ask your calls and live suggestions on Haiku 5.5, about $3
  less on a fully used Pro seat. It waits on the owner's OK for a ~25¢
  comparison.
- Extraction was tried on Haiku 5.5 (81–86% against Sonnet's 85–90%) and
  stays on Sonnet.

**What a seat costs:** live minutes (Deepgram, about $0.0154 a minute for
both sides at list price) and Ask questions (Sonnet) decide it. See ADR 0031.

**Payments:** Dodo Payments instead of Stripe for now.
- The owner is setting it up and will share the details.
- Don't build the switch until then.
- The code is Stripe (ADR 0025). The switch needs an ADR that keeps its
  design: the webhook verified in the database, a paid plan only at checkout,
  seats from the subscription.
- Dodo's fee: 4% + 40¢, plus 0.5% on subscriptions.

**Live transcription** is built (ADR 0022) but off in production. The key
was added to the console's Vercel project, not the web app's; QA's line
"Deepgram grants the overlay a token" shows when it is on. Deepgram facts:
- no click-to-sign DPA: ask security@deepgram.com;
- no hard spending cap: prepaid credit with auto-reload on by default, so
  switch that off.

**Domains (2026-10-17):** the owner bought `tesserafy.com` at Namecheap.
`www.tesserafy.com` serves the landing page (`tesserafy.com` redirects to it;
Namecheap holds an A record for `@` and a CNAME for `www`, as Vercel asked;
the `n8n` A record there is the owner's n8n server). Merged 2026-10-17:
[kaeservs/tesserafy#212](https://github.com/kaeservs/tesserafy/pull/212), the app on `app.tesserafy.com`
(`lib/hosts.ts`). Live the same day: `app.tesserafy.com` is on project web
(Namecheap CNAME `app` → `cname.vercel-dns.com`), `NEXT_PUBLIC_APP_URL` is
`https://app.tesserafy.com` on web (Production) and apps-admin, both
redeployed, and Supabase's Site URL is the app's address with
`https://app.tesserafy.com/**` beside the vercel.app entries.
`admin.tesserafy.com` is on project apps-admin (CNAME `admin` →
`cname.vercel-dns.com`). The console needs no Supabase redirect entry: it
signs in by password and an authenticator code, and sends no email links;
its support links land on the app's address. The overlay keeps calling the
vercel.app address until a release moves it. The Vercel connector works in
cloud sessions: both domains were added through it, with no team slug. Its
fetch of a deployment's page answers 403, and secret values stay the
owner's to set.

**The overlay:** 0.1.27 released 2026-10-17 from GitHub's website (#211),
with 0.1.26's fixes and #210's three buttons; 0.1.26 was never released on
its own. Its installers built and attached themselves as designed, the tag's
own run showing as cancelled. The Mac test and the S1 screen-share check are
not done. **0.1.28,** #213's two overlay fixes (the status line after
signing in, and Start's message while live calls are off), was released
2026-10-19: both builds green, the fuses checked, and the Windows and both
Mac installers attached. **0.1.29** carries the security review's overlay
fixes (below).

**Full QA (2026-10-17), merged 2026-10-19 as [kaeservs/tesserafy#213](https://github.com/kaeservs/tesserafy/pull/213):**
- **Production, through Actions:** e2e 34/34, health clean. A cloud session
  cannot reach tesserafy.com or the vercel.app address, so the rest ran on a
  local copy.
- **The local copy:**
  - Supabase in Docker, with the web app and console as production builds;
  - the real Electron overlay on a virtual display (Xvfb), with audio and
    Deepgram stood in for;
  - every model call answered by a local stand-in, so nothing called Claude
    or spent money;
  - data made only through the app.
- **Works:**
  - sign-up through to Pro with seats, and a teammate added through the
    console;
  - two-step sign-in, plans, export, deletion and support sessions;
  - imports and the sample call, scoring and quotes, insights and patterns,
    Ask, preps, the follow-up email, coaching, scorecards, knowledge, search
    and reports;
  - a whole live call in the overlay, with AI Assist, To Ask, Recap, kept
    answers, Screen and Stop.
- **Fixed in #213:**
  - support windows ended early (migration);
  - Spend's price per seat (migration);
  - the correction form's preselected greeting;
  - the phone header;
  - the console's two-step QR, plan picker and labels;
  - a hydration error;
  - the overlay's status line and its Start message with live calls off.
- **Open for the owner:** the sample call mixes into insights, Ask, Reports
  and Home; Markdown markers in knowledge passages; whether the AI routes
  really run in iad1.
- **Not testable from a session:**
  - real audio on both sides through Deepgram;
  - S1 screen-share invisibility;
  - call detection on Windows and Mac;
  - Stripe checkout, calendar OAuth, Resend sending and HubSpot;
  - real model quality.
- **After the merge (2026-10-19):** CI on main green, both production
  deploys Ready, e2e 34/34 against production (16 quotes across 5 calls,
  verbatim) and health clean. Everything but the migration is live; until
  `supabase db push`, production keeps the old support-window and Spend
  functions.

**Merged 2026-10-19: [kaeservs/tesserafy#215](https://github.com/kaeservs/tesserafy/pull/215),** the owner's ask: Home on a
starting plan shows one line, "Upgrade to keep going", with See plans, in
place of the three plan cards (`components/upgrade-cta.tsx`). After it: CI
on main green, deploys Ready, e2e 34/34 and health clean.

**Security review (2026-10-19), [kaeservs/tesserafy#216](https://github.com/kaeservs/tesserafy/pull/216):** the owner asked for
a full check of vulnerabilities, leaks and passwords. Five reviews ran, one
each for the web app, the database, sign-in and sessions, secrets and CI,
and the overlay. The write-up is `docs/engineering/security-review-2026-10-19.md`.
- **It found a regression in #213's own migration**, not yet in production:
  ending a support window early let its unused sign-in link start an
  untracked session. `20261104090000_security_review.sql` replaces it, so
  the two must be pushed together.
- **Fixed:**
  - support windows end what they started, and support sessions refuse
    the customer's acts;
  - follow-up sending is for paid plans only;
  - provisioning gives a sign-in link only for an account it creates;
  - the overlay forgets a call at sign-out, and moves to app.tesserafy.com;
  - Electron's security patches;
  - Secure cookies, an Origin check, and sign-in links that say whose they
    are;
  - a PDF is measured before it is read. Password-protected and
    "restricted" PDFs are now refused, with a message to save an
    unprotected copy or paste the text;
  - CI actions pinned, and nothing from production in public logs;
  - more, listed in the write-up.
- **Production checked:**
  - the service-role key is only on the console's Vercel project;
  - previews are behind Vercel's login and cannot spend;
  - one unused credential is on the web project (section 5).

**Sign-up** is closed until email (Resend) works and payments are live.

**Data:** only synthetic calls so far. Every accuracy figure is provisional
until real transcripts arrive.

## 5. Waiting on the owner

- **Database:** run `supabase db push`, then `pnpm db:types`. It applies the
  2026-10-19 security migration together with #213's (and #209's, if not
  yet). Never #213's alone: it ended a support window in a way that let the
  window's unused link outlive it, which the security migration replaces.
- **Operator two-step sign-in:** enrol an authenticator on the console, then
  turn the requirement on. Until then one password opens the console.
- **The sample call:** decide whether its invented data should stay out of
  insights, Ask, Reports and Home.
- **Overlay 0.1.29:** release `overlay-v0.1.29` on GitHub's website, target
  `main` (section 3), soon after #216 merges. It carries the security
  review's overlay fixes, and from #216 the web app grants a transcription
  token only for a call the overlay has started, which 0.1.29 is the first to
  do: older overlays are told to update once Deepgram is on.
- **Rotate the e2e account's password.** It was committed to this public repo
  and stays in history. Sign that account out everywhere, then set the new
  one in Actions secrets (`E2E_PASSWORD`) and in `.env`.
- **Decide whether the repository stays public.** The 2026-10-19 review
  recommends private: this file, the reviews and the Actions logs say a lot
  about the product to anyone. If it goes private: Claude's GitHub
  connection works with private repos, but private repos have limited free
  Actions minutes, and Mac builds count extra.
- **Live transcription:**
  - put `DEEPGRAM_API_KEY` on the web app's Vercel project (Production),
    redeploy, and remove it from the console's. Until then, the overlay's
    Start fails for everyone;
  - ask Deepgram for the DPA;
  - switch auto-reload off;
  - make a first real call.
- **Haiku 5.5 for Ask and suggestions:** OK for the ~25¢ comparison?
- **Dodo Payments:** set it up and share the details. Open sign-up only once
  payments are live.
- **Supabase Auth settings to confirm** (from the 2026-10-19 review, which
  could not read them):
  - Confirm email on;
  - Auth's own sign-up off while the app's is closed;
  - secure email change and secure password change on;
  - minimum password length 8 or more, and leaked-password protection on;
  - email codes 8 digits, with a short expiry;
  - JWT expiry an hour or less, with a session time-box and inactivity
    timeout;
  - redirect URLs exact, with no wildcards.
- **Vercel:** delete `GITHUB_TOKEN` and `GITHUB_TICKET_REPO` from the web
  project (unused since ADR 0015), and revoke that token on GitHub.
- **GitHub settings:**
  - secret scanning with push protection, and Dependabot alerts;
  - protect `overlay-v*` tags, and require approval for workflows from forks;
  - delete Health runs from before 2026-10-12;
  - put the e2e secrets in an environment that only `main` can use.
- **Two decisions from the security review:**
  - whether "Find action items", "Find insights" and the follow-up draft on a
    colleague's call are for the call's owner and the company's owners only
    (today any member can, and running one again replaces what was there);
  - whether the overlay outside Incognito comes up folded when a call starts.
    It shows in a screen share, brief included.
- **Anthropic Console:** a monthly spend limit, with auto-reload.
- **Resend:** set it up, then open sign-up. Sending a follow-up is for paid
  plans only since the 2026-10-19 review.
- **Overlay:** the Mac test and the S1 screen-share check.
- **Vercel regions:** check where the AI functions run. `preferredRegion` is
  deprecated, and the deployment reports `sin1`.
- **Ops alerts:** attach the credential and a chat node to "Tesserafy ops
  alerts" in n8n, then publish it.
- **Legal:** the Terms and Privacy pages; set `TERMS_URL` and `PRIVACY_URL`.
- **Code signing:** the certificates, and the country the company is
  registered in.
- **Calendar:** register the Google and Microsoft OAuth apps.
- **HubSpot:** `CRM_TOKEN_KEY`.
- **Call-prep research:** `APIFY_TOKEN`.
- **Other key rotations, at launch:** the n8n MCP key.
- **Zoom app,** so calls arrive without an upload.
- **Real transcripts,** and a decision on the two proposed insights.
- **Skipped for now, at the owner's word:** trackers (`TRACKER_TOKEN_KEY`) and
  the n8n server's own setup.

## 6. What is next

Roughly in order. The owner sets the order.

1. **Haiku 5.5 for Ask and suggestions**, if the comparison holds. It is the
   largest remaining cost lever.
2. **Dodo Payments**, once the account is shared. Then open sign-up.
3. **Security items before launch** (`docs/engineering/security-review-2026-10-19.md`
   lists them; its predecessor's are done or carried into it):
   - mint a support session on the server, so no link outlives its window,
     and end its access token, not only its refresh token;
   - take the consent record's words from the server;
   - a per-person limit on spending the company's allowance, and a dedicated
     path for the tenant-boundary alarm;
   - Electron to a supported major, in its own release;
   - a script CSP with nonces, cookies the page cannot read, a time limit on
     operator sessions, and a CAPTCHA on sign-in;
   - Health in Actions on the counts-only digest instead of the service-role
     key.
4. **After Resend:** the weekly email ("This week"), invites, opening sign-up.
5. **A Zoom app,** so recordings arrive by themselves.
6. **Real transcripts:**
   - a v2 evaluation corpus;
   - recalibrate the insight-clustering threshold;
   - settle `timeline_stated`.
7. **Cluely parity:** check the overlay against Cluely's current release and
   close any gap.
8. **Open from the 2026-10-14 read** (not fixed in #209; each needs a decision
   or a design first):
   - **Live evidence and metering trust the overlay.**
     - `/api/live/sessions/:id/events` stores whatever events the client
       sends. A modified overlay can confirm its seller's own criteria, which
       feed the owners' seller reports.
     - `chargeFromMs` is the client's word.
     - The suggestion gate accepts Assist's charge as well as a detection's.
     - Fix by binding events and charges to the server's own detections.
   - **Redaction masks dates and some number formats as `[phone]`**
     ("2026-10-14", "14.10.2026", "1 250 000"), which hides timelines from
     `timeline_stated`. A number split across a chunk boundary escapes. This
     is a product decision about what is protected.
   - **The security review's open list,** unchanged (section 6, item 3).
   - **The Ask agent** has no `stop_reason` handling: a refusal sends an
     empty tool result and the next call is a 400.
   - **Changing a call's scorecard** deletes people's corrections, and the AI
     guidance learned from them.
   - **Measurement gaps:**
     - multi-window scoring has never been graded;
     - Haiku 5.5 has never been timed server-side;
     - `pnpm smoke:tiers` skips Assist, Ask, action items, the follow-up and
       the prep brief.
   - **Copy:**
     - sign-up and welcome type prices out by hand;
     - one meter has four names;
     - "Customers" is "Accounts" on its own page;
     - the landing page has no Sign in link while sign-up is closed, and
       sells calendar and live calls, which are off.
   - **Housekeeping:**
     - ADRs 0006–0031 are all still "proposed";
     - 20 migrations carry future dates;
     - Actions are pinned to tags, not commit SHAs;
     - `pnpm qa` hard-codes the production URL and an address;
     - the overlay hard-codes the vercel.app domain.

## 7. What cannot carry over, and how to work without it

| Not in the repository | Where it is | Working without it |
|---|---|---|
| **This conversation's history** (every session since September) | The owner's machine, in Claude Code's local history | This file, `CLAUDE.md`, the ADRs, `git log` and the PR descriptions carry its substance |
| **Claude's local memory** (eight notes) | The owner's machine | Folded into sections 1, 3, 4 and 5 |
| **Keys and passwords**: `.env` for operator scripts | The owner's machine | Add only what a task needs to the cloud session's environment variables. The production scripts (`qa`, `e2e`, `health`, `costs`, `support`, `erase`, `db push`, `db:types`) need privileged keys, so the owner may prefer to run them locally. Unit tests, typecheck and lint need no keys. |
| **App settings**: the web app's and console's environment | Two Vercel projects | Section 8 lists the names; the owner sets the values |
| **CI secrets** | GitHub Actions secrets | Section 8 |
| **n8n access**: its MCP server and REST API key | The owner's machine and n8n server | Add n8n as a connector on claude.ai if a task needs it. The ops alerts workflow lives there, inactive. |
| **Supabase access**: a claude.ai connector, and the CLI with a database URL and access token | The owner's claude.ai account and `.env` | Use the claude.ai Supabase connector (CLAUDE.md's MCP routing). Migrations still go through files and `db push`. |
| **GitHub access** | Locally, PRs go through the REST API with a token in `.env` | Claude Code on the web opens PRs through its own GitHub connection; follow the routine in section 3 |
| **Helper scripts**: wait for CI, run the post-merge checks, screenshot the overlay, compare it with the demo pixel by pixel, measure fps and accessibility | A local scratch folder, not committed | The post-merge routine is the commands in section 3. The overlay comparison needs a desktop. |
| **Running the overlay**: Electron, screenshots, real meetings, S1 | A real Windows or Mac desktop | Not possible in the cloud. Leave it to the owner, or do it in a local session. Never capture a real screen. |
| **Release tags and installers** | The owner publishes a release on GitHub's website or pushes a tag; GitHub Actions builds | Always the owner |
| **Accounts and consoles**: Vercel, Supabase dashboard, Anthropic Console, Deepgram, GitHub settings, the n8n server, DNS for the domain, and later Dodo, Resend, Google, Microsoft and Apple developer accounts | The owner | Ask the owner. Never change account settings without being asked. |
| **Windows quirks** | — | A stopped `pnpm start`/`dev` can leave node listening: kill it by port. Check that CSS loads before measuring a page. |

## 8. Infrastructure, by name

**Hosting**
- **Vercel:** two projects, the web app and the operator console, each
  deploying from `main`. Previews sit behind Vercel's own login.
- **Supabase:** Postgres with RLS, pgvector, Auth, the `embed` edge function
  (gte-small) and a nightly plan rollover.

**Outside services**
- **Anthropic** (Claude) and **Deepgram** (transcription).
- Not yet set: **Resend** (email), **Dodo Payments**, **Apify** (prep
  research), **HubSpot** (per company, token sealed), and **Google/Microsoft**
  for calendars.
- **n8n,** self-hosted, carries the ops alerts.

**GitHub Actions**
- `ci.yml`: typecheck, tests, the retrieval guard and pgTAP on every PR.
- `e2e.yml`: daily against production.
- `health.yml`: every four hours.
- `overlay.yml`: builds the installers and attaches them to the release when
  an `overlay-v*` release is published on the website or its tag is pushed.

**Environment variable names** (values are never in the repo)

| Where | Names |
|---|---|
| Web app, Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`*, `RESEND_API_KEY`*, `EMAIL_FROM`*, `STRIPE_SECRET_KEY`* (to become Dodo's), `CALENDAR_TOKEN_KEY`*, `GOOGLE_CLIENT_ID`/`_SECRET`*, `MICROSOFT_CLIENT_ID`/`_SECRET`*, `CRM_TOKEN_KEY`*, `TRACKER_TOKEN_KEY`*, `APIFY_TOKEN`*, `TERMS_URL`*, `PRIVACY_URL`* |
| Console, Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the only place it may be) |
| Operator scripts, `.env` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `E2E_USERNAME`, `E2E_PASSWORD`, `QA_EMAIL`, `TESSERAFY_URL` |
| GitHub Actions secrets | `E2E_BASE_URL`, `E2E_USERNAME`, `E2E_PASSWORD`, `ADMIN_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

\* not set yet, or not on the right project. Its feature is off until it is.

`pnpm env:check` says which operator variables are set, without printing them.

## 9. Decisions

Every decision with a lasting consequence is an ADR in `docs/decisions/`.
Its README is the index. The ones that shape day-to-day work:

- **0002:** model tiers by latency.
- **0003:** scoring from latching criterion states.
- **0004 / 0011:** every vector query is tenant-scoped, in one function.
- **0010:** the measured live latency budget.
- **0014:** stored calls are scored in large windows; T3 is on Sonnet 5.
- **0016:** companies write their own scorecards.
- **0018:** "Ask your calls" is a LangGraph agent.
- **0019:** alerts read counts through a token.
- **0020:** consent is agreed once.
- **0022:** both sides are heard through Deepgram.
- **0023:** follow-ups come from our address.
- **0024:** HubSpot.
- **0025:** payments (Stripe, moving to Dodo).
- **0027:** plans per seat, Incognito.
- **0030:** scoring on Haiku 5.5.
- **0031:** Free is a one-time trial, and what each plan costs us.

Also worth reading:
- `services/eval/benchmarks/results.md`: every measurement, and how far to
  trust it;
- `docs/engineering/security-review-2026-10-19.md` (and its predecessor,
  `security-review-2026-10-12.md`);
- `docs/engineering/qa-checklist.md`: what a machine can't check;
- `docs/experiments/`: spikes S1 and S3, and a load run.

## 10. History

Built from 2026-09-15 to now, in about two hundred pull requests, one feature each.

| PRs | Dates | What happened |
|---|---|---|
| #2–#30 | Sep 15–20 | **Foundations:** the scoring engine, signals and evidence, transcript ingest, the evaluation harness, criterion detection (spike S3), insights, the live scorecard, the first overlay, a design pass |
| #31–#70 | Sep 20–23 | **A platform:** usage telemetry, live suggestions, criterion history, erasure and retention, search, redaction, failures, end-to-end evidence tests, rate limits, lint, support access, the operator console |
| #71–#147 | Sep 23–29 | **Breadth:** consent, teams, plans and sign-up, reports, overlay appearance, Mac, tray and updates, account deletion, trackers, company scorecards, coaching, exports, notifications, customers, operator MFA, This week, disputes, the sample call, mobile and accessibility, call prep, dashboards |
| #148–#178 | Sep 29–Oct 4 | **The Cluely direction:** AI guidance and feedback, action items, prep research, undetectability, the overlay slimmed to Cluely's controls, knowledge, screen, call detection, streaming Assist, "Ask your calls", the follow-up, the ops digest, the recording agreement, a design system, the landing page, early access, calendars |
| #179–#207 | Oct 4–13 | **Launch readiness:** Deepgram transcription, sending follow-ups, CRM, payments (Stripe), live metering, plans per seat with Incognito, onboarding, Mac call detection, landing v2 with the overlay drawn 1:1, Haiku 5.5, the Free trial, the security review |
| #208–#213 | Oct 14–19 | **Toward launch:** this file, fixes from a full read of the project, the overlay redrawn like the demo with each button's last answer kept, releases from GitHub's website, app.tesserafy.com, a full QA pass |

`docs/engineering/build-plan.md` is the original phase plan, P0–P8 and spikes
S1–S3. It is history now, where this file and the ADRs disagree with it. For
example, S2 was settled as Deepgram, and Stripe is giving way to Dodo.

## 11. Glossary

- **T0–T3:** the model tiers (CLAUDE.md).
  - T0: no model.
  - T1: scoring, Haiku 5.5.
  - T2: live help, Sonnet 5.
  - T3: after-call work and the agent, Sonnet 5.
- **Criterion / scorecard:** a thing a good call establishes, such as the pain
  quantified, a timeline, who decides; a scorecard is a set of them.
  - Each criterion's state latches: `unobserved → candidate → confirmed`.
  - The score is arithmetic over those states.
- **Evidence / quote:** the exact words, character for character, that
  support a criterion, signal or insight. A paraphrase is refused.
- **Signal / insight:**
  - a signal is a problem or feature request found in one call;
  - an insight is a pattern across calls, proposed with its evidence and
    never published unasked.
- **Prep / brief:** before a call, who the customer is and what to ask, with
  every point quoted from its source.
- **Assist:** the overlay's four buttons and ask box (`/api/assist`).
- **Live minutes:** minutes of call, charged as the customer's lines are
  scored. An Assist press spends ten seconds.
- **Allowance / meter:** a plan's monthly amounts, counted in
  `take_plan_allowance`. A 402 means one is used up.
- **Support session:** an operator opening a customer's account, recorded
  with a reason and a time limit.
- **Incognito:** the plan on which the overlay is hidden from screen sharing.
- **S1 / S2 / S3:** spikes.
  - S1: is the overlay invisible in real meetings?
  - S2: which streaming transcriber? Deepgram.
  - S3: can a small model score from a short window?
