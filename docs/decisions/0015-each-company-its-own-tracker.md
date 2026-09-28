# 0015 — Each company's tickets go to its own tracker, with a token only the server can open

**Status:** proposed · 2026-09-27 · supersedes P8's single configured repository

## Context

P8 turned an approved insight into a GitHub issue in one repository named in
the web app's environment (`GITHUB_TICKET_REPO`), with one token
(`GITHUB_TOKEN`). Neither was ever set, so no ticket could be raised in
production. Setting them would have been worse: every brand's insights,
quoting its customers, would have landed in Tesserafy's repository instead of
its own.

A company's tracker needs a credential that can write to it, and whatever
stores that credential is holding a secret that belongs to the customer.
Where it lives decides who can use it.

## Options

- **Plain text in the database.** Any member of the company could read the
  token back and use it outside the product, including after they leave.
  Rejected.
- **Supabase Vault.** The web app runs as the signed-in user and never holds
  the service-role key (invariant 3). A path from the web app to the decrypted
  token would therefore be a function any member could call directly, and it
  would hand them the token.
- **Encrypted by the web server with a key only it holds.** The database
  stores ciphertext; the key lives in the web app's environment. A member,
  a backup, or an operator who can read the row gets bytes. It costs one
  environment variable in Vercel.
- **A GitHub App** ("install Tesserafy on your repository"). No token to paste
  and none to store, only an installation id. It needs the app registered
  first, its private key in the environment, and it covers GitHub only.

## Decision

**Encrypted by the web server.** The owner pastes a fine-grained token scoped
to one repository with Issues read and write.

- `apps/web/lib/tracker-secret.ts` seals it with AES-256-GCM under
  `TRACKER_TOKEN_KEY`. The company's id is bound in as associated data, so a
  ciphertext copied into another company's row does not open there. A token
  that was altered, or sealed under another key, fails to open rather than
  opening wrong.
- Before storing, the server checks with GitHub that the repository can be
  read with that token and has issues switched on.
- `company_trackers` holds the target, the ciphertext, and the token's last
  four characters. Customers can select every column except the ciphertext.
  Members see where tickets go; only owners connect or disconnect, logged in
  `tracker_events`.
- `tracker_for_ticket` is the one path to the ciphertext: an approved insight
  in the caller's own company. The ticket route opens the token for that one
  request.
- Closing a company forgets its tracker (a trigger on `closed_at`, because
  closing keeps the company row).
- `provider` is a column, so Jira or Linear is a new value and a new client,
  not a new table. Both were added on 2026-09-28: Jira Cloud only, with the
  target restricted to an `*.atlassian.net` site by a database check (the
  server calls the target, so a free host would let it be pointed anywhere),
  and its email and API token sealed together as JSON; Linear by team key, on
  its one API host.

## Consequences

- **`TRACKER_TOKEN_KEY` must be set in the web app's Vercel environment**
  before anyone can connect a tracker. Until then, owners are told plainly that
  it isn't switched on, and the ticket route answers 503.
- Losing or changing the key means every company reconnects. There is no
  rotation yet; the `v1:` prefix leaves room for one.
- A fine-grained token expires. When it does, the ticket route says the token
  may have expired and where to reconnect.
- A GitHub App remains the better long-term front door for GitHub, since it
  removes token pasting, and this schema takes one without change: the
  installation id would take the token's place.
- The old `GITHUB_TOKEN` and `GITHUB_TICKET_REPO` are no longer read.
