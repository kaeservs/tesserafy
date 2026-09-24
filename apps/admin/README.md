# Operator console

Internal. Lists every account and company across every tenant, and opens a
recorded support session as a user.

## Why it is a separate app

It holds `SUPABASE_SERVICE_ROLE_KEY`, and `apps/web` must never. That is
enforced: `pnpm guard:retrieval` fails CI if the key or `createServiceClient`
appears in any app except this one. A key in the customer app is one bad import
away from a browser bundle, and this product's rows are other companies'
customer calls.

Deploy it as its own Vercel project, on its own hostname, not a subpath of the
customer app.

## Running it

    pnpm --filter @tesserafy/admin dev     # http://localhost:3001

Copy `.env.example` to `apps/admin/.env.local`:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the browser-safe key |
| `SUPABASE_SERVICE_ROLE_KEY` | **only** used to mint a session for a user |
| `NEXT_PUBLIC_APP_URL` | the customer app's origin, where a session lands |

`{NEXT_PUBLIC_APP_URL}/auth/confirm` must also be listed under **Supabase →
Authentication → URL Configuration → Redirect URLs**.

If it is missing, Supabase does not refuse — it falls back to the Site URL.
The link still works and still carries a session, but lands somewhere that does
not read it. The console checks where each link will actually land and says so
when it is wrong, and the product forwards a session that arrives at the wrong
door. Neither replaces the allow-list entry.

A note on how that was learned. The first version of the console put
`redirect_to` inside `options`, which is how the JavaScript SDK spells it but
not how the REST endpoint reads it. Every link fell back to the Site URL, and
the fallback was blamed on the allow-list, which was correct the whole time.

## Becoming an operator

There is no way to grant this from inside the product, deliberately: no RPC
writes to `platform_admins`, so the only path is the service role. Run it once,
against the database, for each person:

```sql
insert into public.platform_admins (user_id, note)
select id, 'why this person has it'
from auth.users
where email = 'them@example.com';
```

Signing in uses the same account and password as the product — there is no
separate operator credential, because a second password store is a second thing
to leak. What differs is what the database will answer once you have a session.

## Opening a session as someone

1. **People** → find them → type a reason → **Open session**.
2. The record is written first. If it fails, nothing is minted.
3. You get a link. **Open it in a private window.**

That last point matters. The link signs that browser in as them, replacing
whatever session it held for the product — including yours. It is a real
session, not a special impersonation mode, which is the honest design and also
the reason to be careful.

Everything you then do is attributed to them. Erase a conversation and
`erasure_events.requested_by` names *them*. The `support_access` row is the
only thing that says otherwise, and the person whose account you opened can
read it.

## What the customer sees

While the session is open, every page of their account carries a banner with
your reason and the time left. You will see it too, in the private window —
that is intended.

## What is not built

- **The time limit is not enforced on the login.** Ending the session, or
  letting it expire, closes the record and removes the banner. The session in
  your private window keeps working until Supabase expires it. Close the
  window when you are done.
- **No consent step.** The customer is told, not asked.
