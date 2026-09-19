-- Phase 5: insights — what several conversations say together.
--
-- An insight cites signals, not segments. A signal already carries verified,
-- quote-checked evidence (ADR 0007), so citing one inherits the quote, the
-- timestamp and the customer without copying any of them. Citing segments
-- directly would duplicate the evidence layer and give quote fidelity a
-- second place to drift.
--
-- The chain a reader follows is therefore:
--
--   insight -> signal -> signal_evidence -> segment -> conversation
--
-- which is why the phase gate's "citing customer and timestamp" needs no new
-- columns: both are already at the end of that chain.

create table public.insights (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  summary      text not null check (length(trim(summary)) > 0),
  -- Which synthesis produced it, e.g. 't3-synthesise@2026-09-19'. Phase 3
  -- measures per version; without this a number is unattributable.
  synthesiser  text not null check (length(trim(synthesiser)) > 0),
  model        text not null check (length(trim(model)) > 0),
  created_at   timestamptz not null default now(),
  unique (company_id, id)
);

create index insights_company_id_idx on public.insights (company_id, created_at desc);

create table public.insight_evidence (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  insight_id  uuid not null,
  signal_id   uuid not null,
  created_at  timestamptz not null default now(),
  -- One signal supports an insight once.
  unique (insight_id, signal_id),
  foreign key (company_id, insight_id)
    references public.insights (company_id, id) on delete cascade,
  foreign key (company_id, signal_id)
    references public.signals (company_id, id) on delete cascade
);

create index insight_evidence_company_id_insight_id_idx
  on public.insight_evidence (company_id, insight_id);

-- "Which insights cite this signal?" — the reverse path, for a conversation
-- page that wants to show where its findings ended up.
create index insight_evidence_company_id_signal_id_idx
  on public.insight_evidence (company_id, signal_id);


-- ---------------------------------------------------------------------------
-- No insight without evidence
-- ---------------------------------------------------------------------------
-- Invariant 4 again, one level up. Deferred for the same reason: an insight
-- and its citations are written in that order inside one transaction.

create function public.assert_insight_has_evidence()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.insight_evidence e where e.insight_id = new.id) then
    raise exception 'insight % has no evidence (invariant 4)', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$fn$;

create function public.assert_insight_still_backed()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.insights i where i.id = old.insight_id) then
    return null;
  end if;

  if not exists (select 1 from public.insight_evidence e where e.insight_id = old.insight_id) then
    raise exception 'insight % has no evidence (invariant 4)', old.insight_id
      using errcode = '23514';
  end if;
  return null;
end;
$fn$;

create constraint trigger insights_require_evidence
  after insert on public.insights
  deferrable initially deferred
  for each row execute function public.assert_insight_has_evidence();

create constraint trigger insight_evidence_keeps_insight_backed
  after delete on public.insight_evidence
  deferrable initially deferred
  for each row execute function public.assert_insight_still_backed();


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.insights         enable row level security;
alter table public.insight_evidence enable row level security;

create policy "members read their company's insights"
  on public.insights for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "members read their company's insight evidence"
  on public.insight_evidence for select to authenticated
  using ((select private.is_company_member(company_id)));


-- ---------------------------------------------------------------------------
-- Writing an insight
-- ---------------------------------------------------------------------------
-- One transaction, like every other write in this pipeline: an insight that
-- kept half its citations would misrepresent how well supported it is, which
-- is the one thing an insight must not do.

create function public.store_insight(
  p_company_id  uuid,
  p_title       text,
  p_summary     text,
  p_synthesiser text,
  p_model       text,
  p_signal_ids  uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_insight_id uuid;
begin
  if p_company_id is null then
    raise exception 'store_insight: p_company_id is required';
  end if;
  if p_signal_ids is null or array_length(p_signal_ids, 1) is null then
    raise exception 'store_insight: an insight needs at least one signal'
      using errcode = '23514';
  end if;

  insert into public.insights (company_id, title, summary, synthesiser, model)
  values (p_company_id, trim(p_title), trim(p_summary), p_synthesiser, p_model)
  returning id into v_insight_id;

  -- The composite foreign key refuses a signal from another company, so a
  -- cross-tenant citation fails here rather than being trusted.
  insert into public.insight_evidence (company_id, insight_id, signal_id)
  select p_company_id, v_insight_id, unnest(p_signal_ids);

  return v_insight_id;
end;
$$;

revoke all on function public.store_insight(uuid, text, text, text, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.store_insight(uuid, text, text, text, text, uuid[])
  to service_role;
