-- Closing a company: when a pilot ends, everything of theirs goes, and the
-- record that it went stays.
--
-- Until now the only delete path was one call at a time, by an owner. A pilot
-- that ends — and pilot contracts usually say what happens to the data when
-- they do — meant an operator erasing calls one by one and then having no way
-- to close the company itself. Synthetic test companies had the same problem.
--
-- What closing does, as one transaction, run by a platform admin:
--   * every call is erased through exactly the logic an owner's erasure uses
--     (moved below into private.erase_conversation_as, unchanged), so each
--     leaves its own content-free erasure_events row and any exported tickets
--     are named for a person to delete;
--   * every membership is removed, each recorded in membership_removals with
--     the operator as the one who removed it. Login accounts stay, empty, and
--     land on the no-company page; deleting an account is an Auth admin call
--     and a separate decision;
--   * the company row stays, as a tombstone: closed_at, by whom, why.
--
-- Why a tombstone and not a delete: the rows that prove the erasure happened —
-- erasure_events, membership_removals, support_access, account_provisioning —
-- point at the company, several by cascade. Deleting the company would delete
-- the evidence that it was deleted. The name is kept because it is our
-- customer's name, not their customers' words, and an audit trail with the
-- name removed cannot answer "did we delete Acme's data?".
--
-- A closed company is closed for good: a trigger refuses any new membership,
-- whichever path tries it.
--
-- Guard rails, in the database rather than the console: platform admins only,
-- a written reason, and the company's exact name typed back. The name check is
-- friction in the one place friction is the point — the console lists every
-- company, and closing the row next to the one meant is not recoverable.

alter table public.companies
  add column closed_at     timestamptz,
  add column closed_by     uuid references auth.users (id) on delete set null,
  add column closed_reason text,
  add constraint companies_closed_complete
    check ((closed_at is null) = (closed_reason is null));

comment on column public.companies.closed_at is
  'Set when an operator closed the company: every call erased, every member removed. The row stays as the record.';


-- ---------------------------------------------------------------------------
-- The erasure itself, without the question of who may ask
-- ---------------------------------------------------------------------------
-- The body of erase_conversation (20260922170000), unchanged except that the
-- person recorded as asking is passed in rather than read from the session.
-- Not callable by anyone directly: only the two functions below reach it, and
-- each decides first whether the caller may.

create function private.erase_conversation_as(
  p_conversation_id uuid,
  p_reason          text,
  p_requested_by    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
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

  select count(*) into v_segments
  from public.segments s where s.conversation_id = p_conversation_id;
  select count(*) into v_signals
  from public.signals s where s.conversation_id = p_conversation_id;
  select count(*) into v_events
  from public.criterion_events e where e.conversation_id = p_conversation_id;

  select coalesce(array_agg(d.insight_id), '{}') into v_doomed
  from (
    select ie.insight_id
    from public.insight_evidence ie
    join public.signals s on s.id = ie.signal_id
    group by ie.insight_id
    having bool_and(s.conversation_id = p_conversation_id)
  ) d;

  v_insights := coalesce(array_length(v_doomed, 1), 0);

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

  delete from public.insights i where i.id = any(v_doomed);
  delete from public.conversations c where c.id = p_conversation_id;

  update public.model_usage u
  set conversation_id = null
  where u.conversation_id = p_conversation_id;

  insert into public.erasure_events
    (company_id, conversation_id, reason, segments_removed, signals_removed,
     events_removed, insights_removed, exported_tickets, requested_by)
  values
    (v_company_id, p_conversation_id, p_reason, v_segments, v_signals,
     v_events, v_insights, v_tickets, p_requested_by);

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

revoke all on function private.erase_conversation_as(uuid, text, uuid) from public, anon, authenticated;


-- The owner's button and the operator's script, as before: the same checks,
-- then the shared erasure.
create or replace function public.erase_conversation(
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

  return private.erase_conversation_as(p_conversation_id, p_reason, v_uid);
end;
$$;


-- ---------------------------------------------------------------------------
-- Closed means closed
-- ---------------------------------------------------------------------------

create function private.refuse_closed_company_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.companies c where c.id = new.company_id and c.closed_at is not null) then
    raise exception 'that company is closed' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger company_members_not_in_closed_company
  before insert or update of company_id on public.company_members
  for each row execute function private.refuse_closed_company_members();


-- ---------------------------------------------------------------------------
-- Closing
-- ---------------------------------------------------------------------------

create function public.close_company(
  p_company_id   uuid,
  p_reason       text,
  p_confirm_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_name    text;
  v_closed  timestamptz;
  v_conv    uuid;
  v_result  jsonb;
  v_calls   integer := 0;
  v_people  integer := 0;
  v_tickets jsonb := '[]'::jsonb;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'close_company: not a platform admin' using errcode = '42501';
  end if;

  select c.name, c.closed_at into v_name, v_closed
    from public.companies c where c.id = p_company_id
    for update;

  if v_name is null then
    raise exception 'close_company: no such company' using errcode = '22023';
  end if;
  if v_closed is not null then
    raise exception 'close_company: % is already closed', v_name using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'close_company: say why' using errcode = '22023';
  end if;
  if p_confirm_name is distinct from v_name then
    raise exception 'close_company: type the company name exactly as it is shown' using errcode = '22023';
  end if;

  -- Closed first, so nobody can be added while the erasure runs.
  update public.companies
     set closed_at = now(), closed_by = v_uid, closed_reason = trim(p_reason), retention_days = null
   where id = p_company_id;

  for v_conv in select c.id from public.conversations c where c.company_id = p_company_id loop
    v_result := private.erase_conversation_as(v_conv, 'operator', v_uid);
    v_calls := v_calls + 1;
    v_tickets := v_tickets || (v_result -> 'exported_tickets');
  end loop;

  -- Every insight rests on evidence from these calls, so none should be left;
  -- if one is, it has nothing left to stand on.
  delete from public.insights i where i.company_id = p_company_id;
  -- Signatures of declined groups: ids only, and every id is now gone.
  delete from public.insight_declines d where d.company_id = p_company_id;

  insert into public.membership_removals (company_id, user_id, email, role, removed_by)
  select m.company_id, m.user_id, u.email, m.role, v_uid
    from public.company_members m
    join auth.users u on u.id = m.user_id
   where m.company_id = p_company_id;
  get diagnostics v_people = row_count;

  delete from public.company_members m where m.company_id = p_company_id;

  return jsonb_build_object(
    'company_id', p_company_id,
    'calls_erased', v_calls,
    'people_removed', v_people,
    'exported_tickets', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from jsonb_array_elements(v_tickets) t)
  );
end;
$$;

revoke all on function public.close_company(uuid, text, text) from public, anon;
grant execute on function public.close_company(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The console's company list says which are closed
-- ---------------------------------------------------------------------------
-- The return type changes, so drop and create rather than replace.

drop function public.admin_companies();

create function public.admin_companies()
returns table (
  company_id     uuid,
  name           text,
  plan           text,
  retention_days integer,
  members        bigint,
  conversations  bigint,
  segments       bigint,
  last_activity  timestamptz,
  failures_24h   bigint,
  spend_30d_usd  numeric,
  closed_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_companies: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.retention_days,
    (select count(*) from public.company_members m where m.company_id = c.id),
    (select count(*) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.segments s where s.company_id = c.id),
    (select max(v.created_at) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.system_failures f
      where f.company_id = c.id and f.created_at > now() - interval '24 hours'),
    coalesce((
      select round(sum(
        (u.input_tokens + u.cache_creation_tokens * 1.25 + u.cache_read_tokens * 0.1) / 1e6
          * case u.model when 'claude-opus-5' then 5 when 'claude-sonnet-5' then 2 else 1 end
        + u.output_tokens / 1e6
          * case u.model when 'claude-opus-5' then 25 when 'claude-sonnet-5' then 10 else 5 end
      )::numeric, 4)
      from public.model_usage u
      where u.company_id = c.id and u.created_at > now() - interval '30 days'
    ), 0),
    c.closed_at
  from public.companies c
  order by c.closed_at is not null, c.name;
end;
$$;

revoke all on function public.admin_companies() from public, anon;
grant execute on function public.admin_companies() to authenticated, service_role;
