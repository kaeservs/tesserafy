Next.js web app — dashboard, review, insight inbox.

Runs as the signed-in user only: every query goes through RLS. The service-role
key never appears here (the retrieval guard fails CI if it does).

Local:

    cp ../../.env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_*
    pnpm dev

Vercel: Root Directory `apps/web`, framework Next.js. Set
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and add
the deployment's `/auth/callback` URL to Supabase → Auth → URL Configuration.
Sign-in is an invite-only magic link.
