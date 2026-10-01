-- A support session ends when its record says it does.
--
-- An operator opens a customer's account through the console (ADR 0012's
-- neighbour, open_support_access): a record with a reason and an expiry, and
-- a sign-in link minted for the customer's address. What that link starts is
-- an ordinary session, and nothing ended it — the record could expire, or the
-- operator press End, and the session went on working, with no banner and no
-- staff flag on anything it read (security review, 2026-10-04).
--
-- A session is a support session if it began while a support record for that
-- account was open: created after the record was, and before it expired. Once
-- that record has ended or expired, this says so, and the web app signs the
-- session out on its next page or request. The customer's own sessions from
-- before the record are untouched; one they happen to start inside the window
-- ends with it, and they sign in again — the price of a rule that needs
-- nothing from the sign-in link itself.

create function public.support_session_ended()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions s
      join public.support_access a on a.subject_user_id = s.user_id
     where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
       and s.user_id = (select auth.uid())
       and s.created_at >= a.created_at
       and s.created_at <= a.expires_at
       and (a.ended_at is not null or a.expires_at <= now())
  );
$$;

comment on function public.support_session_ended() is
  'Whether the caller''s session began inside a support window that has since ended or expired. The web app signs it out.';

revoke all on function public.support_session_ended() from public, anon;
grant execute on function public.support_session_ended() to authenticated;
