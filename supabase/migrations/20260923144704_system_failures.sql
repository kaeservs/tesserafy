-- Failures, kept, and classified.
--
-- The filename carries the version the remote assigned when this was applied,
-- not the one it was written with: the pooler that `supabase db push` needs
-- has been unreliable, so this went in over the REST interface, which numbers
-- its own migrations. Renamed to match so the two histories stay one history.
--
-- Nothing was wrong with the error handling when three tiers were down for
-- four merges. Every route caught the exception, returned a clean 502 and an
-- accurate message. It reported the failure to the end user's browser — the
-- one party that cannot act on it — and to nobody who could. The blindness is
-- not a missing try/catch, it is that a failure has no destination.
--
-- This is the same argument the model_usage table was built on, so it is the
-- same shape: a row in our own database rather than a line in a hosting
-- provider's log buffer that ages out, and rather than a payload posted to an
-- error-tracking vendor. The second half of that is a data-protection choice,
-- not a cost one. An error message carries request context, and in this
-- product request context is meeting content.
--
-- The `kind` column is the point. A 400 saying a parameter is deprecated is a
-- bug in us and somebody must fix it today; a 529 is the weather and fixes
-- itself. Recording both as "error" is how a log becomes wallpaper that nobody
-- reads, which is the failure this table exists to prevent.

-- Both foreign keys cascade, which is where this table parts company with
-- model_usage. A usage row is numbers: erasing the conversation it belonged to
-- unlinks it and keeps it, because the money was spent and cannot be
-- reconstructed. A failure row is a message, and a message can quote the call
-- it failed on. Keeping one after somebody asked for erasure would defeat the
-- erasure, so these rows go with the conversation rather than outliving it —
-- and they go by cascade, not by a line in erase_conversation, because a
-- cascade cannot be forgotten by the next function that deletes a company.

create table public.system_failures (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,

  -- Where it happened, in a form a human recognises: 'api/suggest',
  -- 'script/score', 'api/transcripts'.
  source        text not null check (length(trim(source)) > 0),

  kind          text not null check (kind in (
    -- The upstream understood us and said no: a request we built wrong.
    -- Always our bug, always actionable, and the class that hid for four
    -- merges.
    'model_rejected',
    -- Overloaded, timed out, or 5xx. Retry and it may well work.
    'model_unavailable',
    -- Our database refused: a constraint, a policy, a missing function.
    'database',
    -- The caller sent something we could not use. Not our bug, but a spike in
    -- it means a client is broken or a format changed.
    'input',
    'unknown'
  )),

  tier          text check (tier in ('t1', 't2', 't3')),
  model         text,
  -- The upstream status, where there was one. Kept separately from kind so a
  -- 400 can be told from a 401 without parsing prose.
  status        integer,

  -- Redacted and capped before it arrives. See packages/ai/src/telemetry/
  -- failures.ts: the identifiers a pattern can find are masked, and anything
  -- shaped like a credential is removed, because an upstream error is happy to
  -- quote the request back at you.
  message       text not null,

  created_at    timestamptz not null default now()
);

create index system_failures_created_at_idx on public.system_failures (created_at desc);
create index system_failures_kind_created_at_idx on public.system_failures (kind, created_at desc);
create index system_failures_company_id_created_at_idx
  on public.system_failures (company_id, created_at desc)
  where company_id is not null;

comment on table public.system_failures is
  'One row per failure that reached a user. Append-only. Read by pnpm health.';

alter table public.system_failures enable row level security;

-- Members see their own company's failures. Rows with no company are operator
-- data — most live failures have none, because a T1 detection holds no
-- database credentials and knows no tenant — and need the service role.
create policy "members read their company's failures"
  on public.system_failures for select to authenticated
  using (company_id is not null and (select private.is_company_member(company_id)));


-- ---------------------------------------------------------------------------
-- Recording a failure
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so a route can record without a service-role key, and
-- membership-checked for the same reason record_model_usage is: one company
-- must not be able to write rows against another's history.
--
-- The message is truncated here as well as in the caller. A cap that only
-- exists in TypeScript is a cap that a script written next year will not have.

create function public.record_failure(
  p_source          text,
  p_kind            text,
  p_message         text,
  p_tier            text default null,
  p_model           text default null,
  p_status          integer default null,
  p_company_id      uuid default null,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_company_id is not null
     and not (select private.is_company_member(p_company_id))
     and (select auth.uid()) is not null then
    raise exception 'record_failure: not a member of that company'
      using errcode = '42501';
  end if;

  insert into public.system_failures
    (company_id, conversation_id, source, kind, tier, model, status, message)
  values
    (p_company_id, p_conversation_id, p_source, p_kind, p_tier, p_model, p_status,
     left(coalesce(nullif(trim(p_message), ''), 'no message'), 2000))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_failure(text, text, text, text, text, integer, uuid, uuid)
  from public, anon;
grant execute on function public.record_failure(text, text, text, text, text, integer, uuid, uuid)
  to authenticated, service_role;
