-- Cost telemetry, kept.
--
-- The rule in CLAUDE.md is that usage is logged on every API call because it
-- cannot be backfilled. Until now "logged" meant a line on stdout: fine in a
-- terminal, useless in production, where it lands in a hosting provider's log
-- buffer and ages out. Nobody could answer "what did this customer cost last
-- month" from it, and every day without a table made that permanently less
-- answerable.
--
-- Deliberately not tenant-required. A T1 detection has no company: the window
-- comes from the caller and the endpoint holds no database credentials. Rows
-- without a company are still worth keeping — they are most of the live cost —
-- so company_id is nullable and the read policy treats null as invisible to
-- members rather than visible to all of them.

create table public.model_usage (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete set null,
  conversation_id uuid,
  tier          text not null check (tier in ('t1', 't2', 't3')),
  model         text not null check (length(trim(model)) > 0),
  -- Which prompt version spent this, e.g. 't3-extract@2026-09-19'. Without it
  -- a cost change cannot be attributed to the change that caused it.
  detector      text,
  input_tokens          integer not null default 0 check (input_tokens >= 0),
  output_tokens         integer not null default 0 check (output_tokens >= 0),
  cache_creation_tokens integer not null default 0 check (cache_creation_tokens >= 0),
  cache_read_tokens     integer not null default 0 check (cache_read_tokens >= 0),
  duration_ms   integer not null check (duration_ms >= 0),
  created_at    timestamptz not null default now()
);

create index model_usage_created_at_idx on public.model_usage (created_at desc);
create index model_usage_company_id_created_at_idx
  on public.model_usage (company_id, created_at desc)
  where company_id is not null;

comment on table public.model_usage is
  'One row per model call. Append-only: cost telemetry cannot be reconstructed after the fact.';

alter table public.model_usage enable row level security;

-- Members see their own company's spend and nothing else. Rows with no company
-- are operator data, readable only with the service role.
create policy "members read their company's usage"
  on public.model_usage for select to authenticated
  using (company_id is not null and (select private.is_company_member(company_id)));


-- ---------------------------------------------------------------------------
-- Recording a call
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the web app can record without a service-role key, and
-- membership-checked so one company cannot write rows against another's bill.

create function public.record_model_usage(
  p_tier                  text,
  p_model                 text,
  p_duration_ms           integer,
  p_input_tokens          integer default 0,
  p_output_tokens         integer default 0,
  p_cache_creation_tokens integer default 0,
  p_cache_read_tokens     integer default 0,
  p_detector              text default null,
  p_company_id            uuid default null,
  p_conversation_id       uuid default null
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
    raise exception 'record_model_usage: not a member of that company'
      using errcode = '42501';
  end if;

  insert into public.model_usage
    (company_id, conversation_id, tier, model, detector,
     input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, duration_ms)
  values
    (p_company_id, p_conversation_id, p_tier, p_model, p_detector,
     coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
     coalesce(p_cache_creation_tokens, 0), coalesce(p_cache_read_tokens, 0), p_duration_ms)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_model_usage(text, text, integer, integer, integer, integer, integer, text, uuid, uuid)
  from public, anon;
grant execute on function public.record_model_usage(text, text, integer, integer, integer, integer, integer, text, uuid, uuid)
  to authenticated, service_role;
