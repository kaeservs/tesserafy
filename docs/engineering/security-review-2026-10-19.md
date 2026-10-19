# Security review, 2026-10-19

**Scope.** Everything the [2026-10-12 review](security-review-2026-10-12.md)
covered, re-checked, plus everything shipped since then (#205–#215):

- the web app's routes, server actions, proxy and sign-in flows;
- the database, every policy and function judged by its latest definition;
- authentication, passwords and sessions, in the web app, the console and
  the overlay;
- secrets, leaks, CI and the supply chain, git history included;
- the Electron overlay;
- the production configuration that can be read without a secret: the Vercel
  projects' variable names (never their values), their deployment
  protection, and `pnpm audit`.

**Method.**
- Five read-only reviews, one per area. Each finding was traced from a real
  entry point to the harm, and reproduced on a local copy where that was
  cheap. Database checks ran inside transactions that were rolled back.
- Every finding was checked again in the code before it was fixed.
- After the fixes, these were run:
  - unit tests, typecheck and lint;
  - the retrieval guard;
  - pgTAP on a fresh database;
  - the local production builds.

**What held.**
- **Tenants:** no path crosses them.
  - Functions that take an id were called against another company's rows,
    and refused.
  - Every public table has RLS, and every policy only reads.
- **The public key** reads only the price list. It can run only the ops
  digest, the sign-up switch and Stripe's webhook.
- **SECURITY DEFINER functions:** every one pins its search path.
- **Vercel:**
  - The service-role key is only on the console's project, for
    production.
  - The web app's Anthropic key is production-only, so a preview cannot
    spend.
  - Previews sit behind Vercel's login.
- **Secrets:** none in the shipped code, the bundles or the git history
  this review could read, apart from the e2e password already known.
- **AI spending:** every AI path spends an allowance after its rate limit,
  and a refund needs the charge's own token.
- **Stripe's webhook:** the HMAC, the timestamp window and the replay
  check hold.
- **The overlay:**
  - Its page cannot reach Node.
  - Nothing from a server, a transcript or the model is ever inserted as
    HTML.
  - Its CSP allows no remote content.
- **The 2026-10-12 fixes** hold.

## Fixed

| Finding | Severity | Fix |
|---|---|---|
| **A support window ended early let its unused sign-in link start a session nothing recorded or signed out.** This came from #213's migration, which had not reached production. The session could set the customer's password. | High | **The span:** a window's sessions count until its sign-ins are revoked. **Revoking:** End now, or a sweep each minute once the window is over, revokes them: the unused link, and every session begun inside the window. **Credentials:** while a window is live, the account's password and email do not change at all. That includes Auth's own API, which the web app's refusal never saw. |
| A support session could change plans, retention, members, trackers and the CRM, erase calls, export, delete, publish scorecards and sign the recording agreement, all in the customer's name | Medium | Seventeen functions refuse a support session; before, six did |
| The follow-up email could be sent from our address with any words, by any member on any plan | Medium (high once email is on) | Sending is for paid plans only, at most forty a person a day, in the database. The page offers Send only there, and the route answers 402 with the plan page. |
| Provisioning could hand an operator a sign-in link for an existing account with no record, including another operator's account or one somebody else had created | Medium | Operators' accounts and unconfirmed accounts are refused. An existing account gets no link: the person signs in as usual. |
| Attendees and embeddings could be written onto a colleague's call | Low | Only someone who may change the call writes them |
| `import_conversation` could be called directly with text of any length | Low | Bounded in the database, as the route already was |
| A member could date their own call past retention, and the nightly purge then erased it with no trace | Low | Only an owner sets such a date |
| The old early-access function was still callable, and one visitor could fill its hourly cap | Low | No longer callable |
| A failure row's model was printed raw into the public Health log, and nothing said who wrote the row | Low | A model is kept only if it is a name, and is printed only then; the row records who wrote it |
| Nothing guarded the catalogue as a whole | Low | A pgTAP guard: RLS on every public table, a pinned search path on every SECURITY DEFINER function, and only three functions open to anyone |

The database fixes are `20261104090000_security_review.sql`, tested by
`security_review_1019.test.sql` and `catalogue_guard.test.sql`. That
migration replaces #213's support functions, so **#213's and this migration
go to production together.**

**The web app and the console**

| Finding | Severity | Fix |
|---|---|---|
| Every host under tesserafy.com is the same site, so SameSite=Lax did not keep a page on a sibling host (n8n's, or any later one) from posting to the API with a visitor's cookies | Medium | The proxy refuses a write to `/api/` whose Origin names another host, before Auth is asked anything. A request with no Origin is a program's (the overlay, Stripe) and passes. |
| The session cookie was not Secure, so a browser would send it over plain http | Low | Secure in both apps, always, not decided per request |
| The sign-in form told a stranger which addresses have accounts: only an existing account could be refused for asking twice within a minute | Low | Every answer is "sent"; a real failure is recorded for us, without the address |
| The login page printed whatever text a link's address carried, under Tesserafy's own heading | Low | Only the codes the app sends, in its own words |
| A landing-host path shaped like `//other.site` became a redirect to that site, wherever an edge in front of Next did not normalise it first | Low | The path is set on the app's address, never read as a link |

**The overlay** (0.1.29)

| Finding | Severity | Fix |
|---|---|---|
| After a sign-out, whoever signed in next could open the last account's kept answers, or press Ask and send the last account's whole call to the model under their own name | Medium | Signing out, or a session that turns out to be someone else's, forgets the call, its prep and every answer. Anything still on its way for it is dropped when it arrives. |
| A renewal that landed after someone else signed in made the overlay the last account again, silently, and saved its sign-in. One that landed after a sign-out undid it. | Medium | Each sign-in, sign-out and forget starts a new session. A renewal from an earlier one adopts and saves nothing. |
| A transcription token was for no call. Anyone with live minutes could take tokens and open streams on our Deepgram account with nothing attached to them. | Medium | A token is granted only for a live call the person started in the last twelve hours, so the overlay creates the call first. A call is refused at the start when the plan has no live minutes left. |
| Signing out with an expired token left the refresh token alive on the server | Low | The overlay renews first when it has to, so Auth accepts the sign-out |
| Electron 39.2.6 | Low | 39.8.10, the latest of 39: its Chromium fixes |
| Another program running as the person could relaunch the overlay with a remote-debugging switch and drive its signed-in page; DevTools and Electron's default menu (Reload, Toggle Developer Tools) were there too | Low | An installed overlay exits on either switch, has no DevTools, and has no menu but Edit |
| An installed overlay would send the password to any sign-in address the web app named | Low | Only to Supabase Auth over https |
| The microphone permission also granted the camera | Low | A request is granted only when everything it asks for is sound |
| `reg` was looked up in the current folder before Windows' own | Low | Run by its full path |

**CI and the scripts**

| Finding | Severity | Fix |
|---|---|---|
| A failing browser test printed a page's words into the public Actions log: a customer's quote, a call's title, the test account's name | Medium | A quiet reporter names each test, how it ended and the spec line, never a message. The assertions name ids and positions. |
| Every action was pinned to a tag, which its owner can move to other code. The next step of the Health job holds the service-role key. | Medium | Pinned to commits; Dependabot proposes new ones weekly |
| A pull request's overlay build was kept as a public artifact: an unreviewed installer anyone could download from us | Low | Nothing is kept from a pull request. A release's notes carry each installer's SHA-256. |
| Each checkout left the job's GitHub token in the repository's git configuration for every later step | Low | Not kept |
| The fuse check ran whatever `npx` fetched that minute | Low | The reader is pinned in the lockfile |
| A failure's message kept the integrations' credentials: Jira, Linear, Apify, Google, Deepgram, Basic auth, and a password in a URL | Low | Each is scrubbed before the row is written |
| The retrieval guard knew two names for the service-role key | Low | It knows the others too: the secret key, its prefix, the role's name |
| `pnpm qa` named a person's address and the production host as defaults, and `pnpm support` printed a sign-in link it had already spent | Low | Both come from the environment; the link is printed unused |

## Open

**For the owner** (accounts and settings; no code)

1. **The e2e password.** Rotate it. It is still in the public history.
2. **Operator two-step sign-in.** Enrol on the console, then turn the
   requirement on.
3. **Supabase Auth settings.** The settings to review and their values are
   with the owner. They cover sign-up, password strength and leaked
   passwords, links and codes, sessions, and the redirect allow-list.
4. **Vercel.** Remove an unused credential from the web project, and
   revoke it where it was issued.
5. **GitHub.**
   - Decide public or private.
   - Turn on secret scanning with push protection, and Dependabot alerts.
   - Protect release tags.
   - Require approval for workflows from forks.
   - Delete Health runs from before 2026-10-12.
   - Move the e2e credentials into an environment that only `main` can use.
6. **Code signing** for the overlay's installers.

**In code, not yet done** (named in general terms)

- **Support sessions:**
  - end their access tokens in the database, not only their refresh
    tokens;
  - better, mint the support session on the server, so there is no link
    to outlive its window.
- **Live scoring and metering:** take the server's word, not the
  overlay's.
- **The recording agreement:** take its words and version from the
  server.
- **Abuse limits:**
  - a per-person limit on allowance spending;
  - a dedicated path for the tenant-boundary alarm.
- **Hardening:**
  - a script CSP with nonces;
  - cookies the page cannot read;
  - a time limit on operator sessions;
  - a CAPTCHA on sign-in.
- **The overlay:**
  - move to a supported Electron major, in its own release;
  - build the page without the file-protocol privilege;
  - check the sender of every IPC message.
- **Health in Actions:** read the counts-only digest instead of using the
  service-role key.

**Decisions**

- **Rewriting colleagues' calls.** Should "Find action items", "Find
  insights" and the follow-up draft on a colleague's call be limited to the
  call's owner and the company's owners? Today any member can run them, and
  running them again replaces what was there.
- **The overlay outside Incognito.** On the other plans the overlay shows in
  a screen share, and it comes up by itself when a call starts, its brief
  included. It could come up folded instead.
