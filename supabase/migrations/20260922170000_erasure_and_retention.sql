-- Erasing a meeting, and not keeping one forever.
--
-- Two gaps, both of which get worse every day they are left:
--
--   1. There was no delete path anywhere. Not "an unimplemented feature" —
--      an impossible one. `insight_evidence_keeps_insight_backed` raises
--      23514 when the last evidence for an insight is removed, so deleting a
--      conversation whose signals solely supported an insight *failed*.
--      Invariant 4 outranked a customer's right to be forgotten.
--
--   2. Nothing aged out. Every transcript ever ingested was kept for good,
--      which is the position hardest to defend and the easiest to fix before
--      there is much to defend.
--
-- ---------------------------------------------------------------------------
-- How the conflict with invariant 4 is resolved
-- ---------------------------------------------------------------------------
-- An insight that rested entirely on an erased conversation is deleted with
-- it. That is not a weakening of invariant 4, it is the invariant applied:
-- this product refuses to show a claim it cannot evidence, and once the
-- evidence is gone the claim is exactly that. An insight supported by several
-- conversations survives with fewer citations, which already worked — the
-- trigger only ever objected to the last one.
--
-- The alternative was keeping the insight and marking its evidence erased.
-- Rejected: an insight's summary is written *from* the customer's words and
-- frequently contains them, so "keep the conclusion, drop the quotes" keeps a
-- claim about somebody who asked to be forgotten, in language they supplied.
--
-- ---------------------------------------------------------------------------
-- What the erasure log may contain
-- ---------------------------------------------------------------------------
-- That an erasure happened, never what was erased. Counts, ids, who asked and
-- when. No titles, no quotes, no speaker names — a log that recorded those
-- would itself become a thing you have to erase, which is how "we deleted it"
-- turns out not to be true.
--
-- The one exception is the URL of a ticket already raised in an external
-- tracker. That quote left this system before the erasure and cannot be
-- recalled from here, so the log names where it went and a person finishes
-- the job. Saying nothing would be a more comfortable lie.

alter table public.companies
  add column retention_days integer
    check (retention_days is null or retention_days between 1 and 3650);

comment on column public.companies.retention_days is
  'Conversations older than this are erased by purge_expired_conversations(). Null keeps them indefinitely — a deliberate choice, not a default worth being comfortable with.';


create table public.erasure_events (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  -- The conversation is gone, so this is a dangling id on purpose: it is what
  -- lets an operator answer "was this erased?" without keeping the thing.
  conversation_id  uuid not null,
  reason           text not null check (reason in ('request', 'retention', 'operator')),
  segments_removed integer not null default 0,
  signals_removed  integer not null default 0,
  events_removed   integer not null default 0,
  insights_removed integer not null default 0,
  -- Tickets whose bodies already carry quotes into a tracker this system does
  -- not control. Recorded so somebody can go and delete them.
  exported_tickets jsonb not null default '[]'::jsonb,
  requested_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.erasure_events is
  'Append-only record that an erasure happened. Deliberately holds no content: a log of what was deleted is a second copy of it.';

create index erasure_events_company_id_created_at_idx
  on public.erasure_events (company_id, created_at desc);

alter table public.erasure_events enable row level security;

create policy "members read their company's erasures"
  on public.erasure_events for select to authenticated
  using ((select private.is_company_member(company_id)));


-- ---------------------------------------------------------------------------
-- Erasing one conversation
-- ---------------------------------------------------------------------------

create function public.erase_conversation(
  p_conversation_id uuid,
  p_reason          text default 'request'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_uid        uuid := (select auth.uid());
  v_segments   integer;
  v_signals    integer;
  v_events     integer;
  v_insights   integer;
  v_tickets    jsonb;
  v_doomed     uuid[];
begin
  select c.company_id into v_company_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'erase_conversation: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  -- An operator holding the service role has no auth.uid(). A signed-in
  -- caller must own the company: erasure is not an ordinary member's button,
  -- because it cannot be undone and the log cannot bring anything back.
  if v_uid is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'erase_conversation: only an owner may erase'
      using errcode = '42501';
  end if;

  select count(*) into v_segments
  from public.segments s where s.conversation_id = p_conversation_id;
  select count(*) into v_signals
  from public.signals s where s.conversation_id = p_conversation_id;
  select count(*) into v_events
  from public.criterion_events e where e.conversation_id = p_conversation_id;

  -- Insights whose every citation comes from this conversation. Those are the
  -- ones the evidence trigger would refuse to leave unbacked, and the ones
  -- that have nothing left to say once it is gone.
  select coalesce(array_agg(d.insight_id), '{}') into v_doomed
  from (
    select ie.insight_id
    from public.insight_evidence ie
    join public.signals s on s.id = ie.signal_id
    group by ie.insight_id
    having bool_and(s.conversation_id = p_conversation_id)
  ) d;

  v_insights := coalesce(array_length(v_doomed, 1), 0);

  -- Every ticket that cites *anything* from this conversation, not only the
  -- ones about to be deleted. An insight that survives on other evidence may
  -- still have carried these quotes into a tracker, and the point of this
  -- list is the quotes that already left, not the rows about to go.
  select coalesce(jsonb_agg(distinct jsonb_build_object('provider', t.provider, 'url', t.url)), '[]'::jsonb)
    into v_tickets
  from public.insight_tickets t
  where exists (
    select 1
    from public.insight_evidence ie
    join public.signals s on s.id = ie.signal_id
    where ie.insight_id = t.insight_id
      and s.conversation_id = p_conversation_id
  );

  -- Order matters. The insights go first, so that cascading the conversation
  -- away cannot trip the "no insight without evidence" trigger on its way out.
  delete from public.insights i where i.id = any(v_doomed);
  delete from public.conversations c where c.id = p_conversation_id;

  -- Cost telemetry stays; its link to the erased conversation does not. The
  -- money was spent and cannot be reconstructed later, and an opaque id
  -- pointing at something that no longer exists is a thread worth cutting.
  update public.model_usage u
  set conversation_id = null
  where u.conversation_id = p_conversation_id;

  insert into public.erasure_events
    (company_id, conversation_id, reason, segments_removed, signals_removed,
     events_removed, insights_removed, exported_tickets, requested_by)
  values
    (v_company_id, p_conversation_id, p_reason, v_segments, v_signals,
     v_events, v_insights, v_tickets, v_uid);

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'segments_removed', v_segments,
    'signals_removed', v_signals,
    'events_removed', v_events,
    'insights_removed', v_insights,
    'exported_tickets', v_tickets
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Ageing out
-- ---------------------------------------------------------------------------
-- Retention is per company and stored as data, for the same reason criteria
-- are: a customer asking for ninety days should be a row, not a deploy.
--
-- occurred_at rather than created_at, because what expires is the meeting,
-- not the import. A call from two years ago imported yesterday is two years
-- old. A conversation with no date falls back to when it was created, since
-- the alternative is keeping it forever by accident.

create function public.purge_expired_conversations(
  p_company_id uuid default null,
  p_limit      integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_erased  integer := 0;
begin
  if (select auth.uid()) is not null then
    raise exception 'purge_expired_conversations: operator only'
      using errcode = '42501';
  end if;

  for v_id in
    select c.id
    from public.conversations c
    join public.companies co on co.id = c.company_id
    where co.retention_days is not null
      and (p_company_id is null or c.company_id = p_company_id)
      and coalesce(c.occurred_at, c.created_at) < now() - make_interval(days => co.retention_days)
    order by coalesce(c.occurred_at, c.created_at)
    limit greatest(p_limit, 0)
  loop
    perform public.erase_conversation(v_id, 'retention');
    v_erased := v_erased + 1;
  end loop;

  return jsonb_build_object('erased', v_erased);
end;
$$;


-- ---------------------------------------------------------------------------
-- Who may call these
-- ---------------------------------------------------------------------------
-- erase_conversation is reachable by an owner, because a customer asking for
-- their meeting to be deleted should not need us in the loop. The purge is
-- operator-only: it is a scheduled sweep, and nothing signed in should be
-- able to trigger a bulk delete across a company.

revoke all on function public.erase_conversation(uuid, text) from public, anon;
grant execute on function public.erase_conversation(uuid, text) to authenticated, service_role;

revoke all on function public.purge_expired_conversations(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_conversations(uuid, integer) to service_role;
