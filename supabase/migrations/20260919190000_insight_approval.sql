-- Phase 8: an insight becomes a ticket, and only a person can start that.
--
-- Two rules from the phase gate shape this, and the schema is where they are
-- actually enforced rather than merely intended:
--
--   Nothing is created automatically. An insight is written as 'proposed' and
--   stays there until a member approves it. The ticket route refuses anything
--   not approved, and the database refuses to record a ticket for it.
--
--   The ticket carries its evidence. That is the product's whole claim, so a
--   ticket row keeps the insight it came from; the citations are rendered from
--   that chain rather than copied, and cannot drift from it.
--
-- Approval is the first thing in this system a signed-in user writes. RLS
-- cannot restrict an update to one column, so it happens through a
-- SECURITY DEFINER function that checks membership and stamps the approver
-- from auth.uid() — a caller cannot approve as somebody else.

alter table public.insights
  add column status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'dismissed')),
  add column decided_by uuid references auth.users (id),
  add column decided_at timestamptz,
  add constraint insights_decision_is_complete check (
    (status = 'proposed' and decided_by is null and decided_at is null)
    or (status <> 'proposed' and decided_by is not null and decided_at is not null)
  );

create table public.insight_tickets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  insight_id   uuid not null,
  provider     text not null check (provider in ('github')),
  external_id  text not null check (length(trim(external_id)) > 0),
  url          text not null check (url like 'https://%'),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  -- One ticket per insight per provider: clicking twice must not open two.
  unique (insight_id, provider),
  foreign key (company_id, insight_id)
    references public.insights (company_id, id) on delete cascade
);

create index insight_tickets_company_id_insight_id_idx
  on public.insight_tickets (company_id, insight_id);

alter table public.insight_tickets enable row level security;

create policy "members read their company's tickets"
  on public.insight_tickets for select to authenticated
  using ((select private.is_company_member(company_id)));


-- ---------------------------------------------------------------------------
-- Deciding on an insight
-- ---------------------------------------------------------------------------

create function public.decide_insight(p_insight_id uuid, p_status text)
returns public.insights
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight public.insights;
begin
  if p_status not in ('approved', 'dismissed') then
    raise exception 'decide_insight: status must be approved or dismissed'
      using errcode = '22023';
  end if;

  select * into v_insight from public.insights where id = p_insight_id;
  if not found then
    raise exception 'decide_insight: insight % not found', p_insight_id
      using errcode = 'P0002';
  end if;

  -- SECURITY DEFINER bypasses RLS, so membership is checked here explicitly.
  -- Without this, any signed-in user could decide any company's insights.
  if not (select private.is_company_member(v_insight.company_id)) then
    raise exception 'decide_insight: not a member of that company'
      using errcode = '42501';
  end if;

  update public.insights
  set status = p_status,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_insight_id
  returning * into v_insight;

  return v_insight;
end;
$$;

revoke all on function public.decide_insight(uuid, text) from public, anon;
grant execute on function public.decide_insight(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Recording a ticket
-- ---------------------------------------------------------------------------
-- Separate from creating it: the ticket is created by a server route holding a
-- provider token, and this is what makes it durable. It refuses an insight
-- nobody approved, which is the gate's "no auto-creation" rule expressed where
-- it cannot be forgotten.

create function public.record_insight_ticket(
  p_insight_id  uuid,
  p_provider    text,
  p_external_id text,
  p_url         text
)
returns public.insight_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight public.insights;
  v_ticket  public.insight_tickets;
begin
  select * into v_insight from public.insights where id = p_insight_id;
  if not found then
    raise exception 'record_insight_ticket: insight % not found', p_insight_id
      using errcode = 'P0002';
  end if;

  if not (select private.is_company_member(v_insight.company_id)) then
    raise exception 'record_insight_ticket: not a member of that company'
      using errcode = '42501';
  end if;

  if v_insight.status <> 'approved' then
    raise exception 'record_insight_ticket: insight % is %, not approved',
      p_insight_id, v_insight.status
      using errcode = '23514';
  end if;

  insert into public.insight_tickets
    (company_id, insight_id, provider, external_id, url, created_by)
  values
    (v_insight.company_id, p_insight_id, p_provider, p_external_id, p_url,
     (select auth.uid()))
  returning * into v_ticket;

  return v_ticket;
end;
$$;

revoke all on function public.record_insight_ticket(uuid, text, text, text) from public, anon;
grant execute on function public.record_insight_ticket(uuid, text, text, text)
  to authenticated, service_role;
