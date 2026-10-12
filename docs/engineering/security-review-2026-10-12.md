# Security review, 2026-10-12

**Scope.** Everything except the n8n server, which the owner asked to skip:

- the web app's routes and server actions;
- the database (every policy and function, judged by its latest definition);
- secrets, configuration and CI;
- the Electron overlay and the operator console;
- production probed from outside.

**Method.**
- **Code:** four read-only reviews, one per area.
- **Production:**
  - headers and exposed paths;
  - the shipped JavaScript scanned for keys;
  - every table read with the public key;
  - storage, the embed function, and Auth settings;
  - Supabase's own security advisor.
- **Verification:** each finding was traced in the code, and reproduced where that was cheap, before it was fixed.

**What held.**
- No path crosses tenants.
- No secret is in the shipped code or in git history.
- The public key reads only the price list.
- Every table has RLS, and every SECURITY DEFINER function pins its search path.
- The overlay's renderer cannot reach Node.
- Every console entry point checks for an operator.
- Most of the 2026-10-04 review held up.

## Fixed

| Finding | Severity | Fix |
|---|---|---|
| **The repository is public**, and a production account's password was in the e2e specs: a member of the internal company, on an unlimited plan | High | Removed from every spec. `e2e/credentials.ts` reads `E2E_USERNAME`/`E2E_PASSWORD` from the environment and fails without them. **The password stays in git history until it is rotated.** |
| A failing e2e run uploaded Playwright traces, which hold session cookies and meeting text, as public artifacts | High | No artifact upload. No trace or screenshot in CI. `permissions: contents: read`. |
| `/api/assist` and `/api/suggest` spent no allowance: a Free account could call Sonnet up to the rate limits, worst case $1–4k a month | Medium-high | Assist spends 10 live seconds a press, refunded on failure (`ASSIST_LIVE_SECONDS`). A suggestion is answered only within two minutes of the caller's own charged detection. Ids and speakers now count toward Assist's transcript budget. |
| A transcription token allows Deepgram streams that outlive it, issued 10 a minute and 200 a day | High (once Deepgram is on) | 4 a minute and 30 a day. The hard ceiling is the Deepgram balance: see Open. |
| The VTT timing regex backtracked quadratically: a 2 MB line held a function for most of an hour, before any charge | Medium | Linear pattern; the line quoted back is truncated. Test: 200,000 characters in under 500 ms. |
| A knowledge upload was parsed before the owner check; a .docx is a zip, and 4 MB can inflate to gigabytes | Medium | Owner checked first. `docxFitsIn` inflates every part with a hard cap before mammoth runs. |
| Health printed production failure messages to public Actions logs | Medium | In Actions it prints counts, kinds and route names only. |
| Members could write any `source` into `system_failures`, which `ops_digest` passes on to the chat app, and any token count into `model_usage` (~$64k of fake spend a row) | Medium | Constraints: a source is a route name; token counts and durations are ones a model could produce. |
| While nothing is paid for, an owner could set 500 seats, which is 500× the allowance | Medium | At most five seats more than the company's people, unless the seats are paid for. |
| `take_rate_limit_tokens` took any number of windows and any bucket name | Low | Up to four windows, and a short bucket name. |
| A removed author could still delete their notes | Low | Must still be a member. |
| A call or prep dated far in the future escaped retention | Low | Constraints. The import route also refuses a date that is invalid or in the future, before charging. |
| Next.js 16.3.5: seven advisories | Medium | 16.3.8. sharp and source-map-js are pinned to patched versions. |
| Headers | Low | `X-Powered-By` dropped. CSP adds `object-src 'none'; base-uri 'self'`. |
| `.gitignore` missed `.env.production` and similar | Low | `.env.*`, except the examples. |
| The overlay release ran an unpinned `npx @electron/fuses` | Low | Pinned to 1.8.0. |

The database fixes are `20261101090000_security_hardening.sql`, tested by `security_hardening.test.sql`. That migration is applied to production.

## Open

**For the owner**

1. **Rotate the e2e account's password**, and set the new value in GitHub Actions secrets (`E2E_PASSWORD`) and in `.env`.
2. **Decide whether the repository should stay public.** Everything committed so far is readable. Making it private stops new exposure, but not what was already cloned.
3. **Deepgram: switch off auto-reload, or keep the balance small.** A token's streams run on our account, and only the balance stops them.
4. **Supabase Auth: turn on leaked-password protection** (Authentication → Policies). The advisor flags it.
5. **Open sign-up only with payments on.** While upgrades are free, any owner can move to Incognito.

**In code, not yet done**

- **Support sessions:**
  - the end of a window is enforced by the web app, not the database;
  - a link opened after its window ends gives a session that is never signed out;
  - some functions don't refuse a support session (`change_plan`, `cancel_plan`, `set_retention`, `erase_conversation`, `connect_tracker`, `record_company_export`, `tracker_for_ticket`, `disconnect_crm`).
  - Fix: end the Auth session when the window ends, and check `in_support_session()` in each.
- **Console provisioning:** for an existing account in no company, provisioning returns a magic link with no support record. It should send Auth's email instead, and refuse operators.
- **Follow-up send** can be used as a relay from `EMAIL_FROM` once Resend is on: any member, any recipients, a draft faked with `record_follow_up`. It should be paid plans only, with a draft the server made, before `RESEND_API_KEY` is set.
- **Transcription tokens** should be bound to the caller's live call. That needs the overlay to send its conversation id (next overlay release).
- **The consent record** stores the words and Terms version the caller sends. `agree_to_recording` should take the server's own.
- **Members can rewrite colleagues' calls:** `record_action_items`, `record_follow_up`, `record_extracted_signals` and `record_segment_embeddings` check membership, not `may_edit_conversation`. That stays inside one company.
- **Electron 39 is out of support.** Upgrade to a supported major version (42–44) in its own release.
- **Hardening:**
  - a script CSP with nonces;
  - an Origin check on JSON API routes;
  - service-role guard patterns for computed names;
  - a catalogue-wide pgTAP guard (RLS on, search_path set, anon only where intended).

Accepted as is:
- the login CSRF through `/auth/confirm` (documented);
- `sprintf-js` (moderate, no fix, in mammoth's command-line code, which is never run).
