-- A group of signals Opus has already judged is not one finding is not sent
-- to Opus again.
--
-- "Look for patterns" re-clusters a company's uncited signals every time it is
-- pressed, and clustering is deterministic over unchanged data. So a group
-- synthesis declined came straight back on the next press, and Opus was paid
-- again to reach the same verdict — observed on #81, where the false
-- "They want..." cluster was declined twice in a row.
--
-- A decline is remembered against the exact set of signals. If a later call
-- adds a signal to the group, the set differs and the group is judged afresh,
-- which is right: new evidence deserves a new look. Only two outcomes are
-- remembered — `declined` (the model's judgement) and `too-narrow` (after
-- narrowing, too few signals). A synthesis that cited signals it was never
-- given is a fault, not a verdict, and is retried.
--
-- Only ids and a reason code are stored, never the model's own wording, so
-- nothing here is meeting content.

create table public.insight_declines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  -- The sorted signal ids, joined. Computed by the function below, never by a
  -- caller, so two callers cannot disagree about what "the same group" means.
  signature     text not null,
  signal_ids    uuid[] not null check (array_length(signal_ids, 1) > 0),
  reason        text not null check (reason in ('declined', 'too-narrow')),
  synthesiser   text not null,
  created_at    timestamptz not null default now(),
  unique (company_id, signature)
);

comment on table public.insight_declines is
  'Signal groups synthesis judged not to be one finding, so they are not re-synthesised.';

alter table public.insight_declines enable row level security;

create policy "members read their company's declines"
  on public.insight_declines for select to authenticated
  using ((select private.is_company_member(company_id)));


create function public.record_insight_decline(
  p_company_id  uuid,
  p_signal_ids  uuid[],
  p_reason      text,
  p_synthesiser text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sorted uuid[];
begin
  if p_company_id is null or p_signal_ids is null or array_length(p_signal_ids, 1) is null then
    raise exception 'record_insight_decline: a company and at least one signal are required'
      using errcode = '22023';
  end if;

  -- A member for their own company; the service role (operator scripts) for
  -- any. The same rule every write in this schema uses.
  if (select auth.uid()) is not null
     and not (select private.is_company_member(p_company_id)) then
    raise exception 'record_insight_decline: not a member of that company'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(p_signal_ids) as cited(signal_id)
    where not exists (
      select 1 from public.signals s
      where s.id = cited.signal_id and s.company_id = p_company_id
    )
  ) then
    raise exception 'record_insight_decline: every signal must belong to this company'
      using errcode = '42501';
  end if;

  -- Sorted byte by byte (collate "C"), so the signature matches the one the
  -- application builds with an ordinary JavaScript string sort. A language
  -- collation can ignore the hyphens in a uuid and order them differently, and
  -- then the two signatures would never match and nothing would be remembered.
  -- Deduplicated in a subquery: DISTINCT inside array_agg would require the
  -- sort expression to be the aggregated one.
  select array_agg(d.x order by d.x::text collate "C") into v_sorted
  from (select distinct x from unnest(p_signal_ids) as x) as d;

  insert into public.insight_declines (company_id, signature, signal_ids, reason, synthesiser)
  values (p_company_id, array_to_string(v_sorted, ','), v_sorted, p_reason, p_synthesiser)
  on conflict (company_id, signature) do nothing;
end;
$$;

revoke all on function public.record_insight_decline(uuid, uuid[], text, text) from public, anon;
grant execute on function public.record_insight_decline(uuid, uuid[], text, text)
  to authenticated, service_role;
