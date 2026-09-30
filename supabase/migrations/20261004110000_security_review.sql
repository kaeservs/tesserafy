-- What the security review of 2026-10-04 found in the database, fixed.
--
-- 1. Plan allowances could be refunded by the person who spent them.
--    refund_plan_allowance took a ledger id, and members can read their
--    company's ledger, so any successful piece of AI work could be given back
--    from a browser and no plan limit held. A refund now needs a one-time
--    token that take_plan_allowance returns to the server that spent it; only
--    its hash is kept, where no API can read it. The amount taken is fixed by
--    the meter, so nobody can spend a colleague's month in one call.
-- 2. Any member could write evidence onto, or add lines to, any call in the
--    company. record_criterion_events now asks may_edit_conversation (whoever
--    added the call, or an owner), as dispute_criterion always has; and lines
--    are appended only to a live call, by whoever is capturing it, within 12
--    hours of its start.
-- 3. Any signed-in account could write failure and usage rows with no
--    company, enough to push real failures out of what the alarm read, and
--    could point usage at another company's call. A person now records only
--    for their own company, and a call named must be that company's.
-- 4. Erasing a call left its words in the briefs of that customer's call
--    preps, and preps never aged out with retention. Erasing a call now clears
--    those briefs (and the lessons taken from them), and the retention purge
--    takes preps too.
-- 5. A support session could be opened on another operator's account.
-- 6. Someone removed from a company could still edit their notes, withdraw
--    their corrections and answer coaching there.
-- 7. Closing a company left what it taught the AI, its call types and its
--    goals behind.
--
-- Each is pinned in supabase/tests/database/security_review.test.sql.

-- ---------------------------------------------------------------------------
-- 1. Refunds need the token the spending returned
-- ---------------------------------------------------------------------------

create table private.plan_refund_tokens (
  ledger_id  bigint primary key references public.usage_ledger (id) on delete cascade,
  token_hash bytea not null
);

create or replace function public.take_plan_allowance(p_meter text, p_amount integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_plan       text;
  v_limit      integer;
  v_used       integer;
  v_id         bigint;
  v_token      text;
begin
  if p_meter not in ('calls', 'extractions', 'pattern_runs', 'live_seconds') then
    raise exception 'take_plan_allowance: no meter %', p_meter using errcode = '22023';
  end if;
  -- One of anything; live time by the utterance, 5 to 30 seconds (lib/plan).
  if p_amount is null or (p_meter <> 'live_seconds' and p_amount <> 1)
     or (p_meter = 'live_seconds' and p_amount not between 1 and 60) then
    raise exception 'take_plan_allowance: that amount is not one this meter takes' using errcode = '22023';
  end if;

  perform private.roll_subscription(v_company_id);

  -- Locked, so two requests for the last unit of an allowance queue here and
  -- the second sees the first's row.
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select c.plan into v_plan from public.companies c where c.id = v_company_id;
  v_limit := private.plan_limit(v_plan, p_meter);

  select coalesce(sum(l.amount), 0)::integer into v_used
    from public.usage_ledger l
   where l.company_id = v_company_id and l.meter = p_meter
     and l.period_start = v_sub.period_start and l.refunded_at is null;

  if v_limit is not null and v_used + p_amount > v_limit then
    return jsonb_build_object(
      'allowed', false, 'meter', p_meter, 'used', v_used, 'limit', v_limit,
      'plan', v_plan, 'status', v_sub.status, 'resets_at', v_sub.period_end);
  end if;

  insert into public.usage_ledger (company_id, meter, amount, period_start, user_id)
  values (v_company_id, p_meter, p_amount, v_sub.period_start, (select auth.uid()))
  returning id into v_id;

  -- The refund token goes back to whoever called, once; only its hash stays.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into private.plan_refund_tokens (ledger_id, token_hash)
  values (v_id, sha256(convert_to(v_token, 'UTF8')));

  return jsonb_build_object(
    'allowed', true, 'ledger_id', v_id, 'refund_token', v_token, 'meter', p_meter, 'used', v_used + p_amount,
    'limit', v_limit, 'plan', v_plan, 'status', v_sub.status, 'resets_at', v_sub.period_end);
end;
$$;

-- Give back what a failed piece of AI work took: only with the token its
-- spending returned, only once, and only within the hour.
drop function public.refund_plan_allowance(bigint);
create function public.refund_plan_allowance(p_ledger_id bigint, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.usage_ledger l
     set refunded_at = now()
   where l.id = p_ledger_id
     and l.user_id = (select auth.uid())
     and l.refunded_at is null
     and l.at > now() - interval '1 hour'
     and exists (
       select 1 from private.plan_refund_tokens t
        where t.ledger_id = l.id and t.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
     );
  if found then
    delete from private.plan_refund_tokens where ledger_id = p_ledger_id;
  end if;
end;
$$;

revoke all on function public.refund_plan_allowance(bigint, text) from public, anon;
grant execute on function public.refund_plan_allowance(bigint, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Evidence and lines only from whoever may
-- ---------------------------------------------------------------------------

alter table public.conversations add column captured_live boolean not null default false;

comment on column public.conversations.captured_live is
  'Started as a live call (start_live_conversation): the only kind of call lines are appended to.';

create or replace function public.record_criterion_events(
  p_conversation_id uuid,
  p_events          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id       uuid;
  v_engagement_type  text;
  v_criteria_version integer;
  v_event            jsonb;
  v_segment_text     text;
  v_offset           integer;
  v_quote            text;
  v_kind             text;
  v_recorded         integer := 0;
  v_rejected         integer := 0;
  v_added_by         uuid;
begin
  select c.company_id, c.engagement_type, c.criteria_version, c.added_by
    into v_company_id, v_engagement_type, v_criteria_version, v_added_by
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'record_criterion_events: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_criterion_events: not a member of that company'
      using errcode = '42501';
  end if;
  -- Whoever added the call scores it (an upload, a live call), or an owner
  -- re-scores it; nobody else writes evidence onto someone else's call.
  if not private.may_edit_conversation(v_company_id, v_added_by) then
    raise exception 'record_criterion_events: only whoever added the call, or an owner, can score it'
      using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'record_criterion_events: p_events must be an array'
      using errcode = '22023';
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_quote := v_event->>'quote';
    v_kind  := coalesce(v_event->>'kind', 'evidence');

    select s.text into v_segment_text
    from public.segments s
    where s.id = (v_event->>'segment_id')::uuid
      and s.conversation_id = p_conversation_id
      and s.company_id = v_company_id;

    if v_segment_text is null
       or v_quote is null
       or length(trim(v_quote)) = 0
       or v_kind not in ('evidence', 'contradiction')
       or not exists (
         select 1 from public.criteria_definitions d
         where d.engagement_type = v_engagement_type
           and d.version = v_criteria_version
           and d.key = v_event->>'criterion_key'
           and (d.company_id is null or d.company_id = v_company_id)
       )
    then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    v_offset := position(v_quote in v_segment_text);
    if v_offset = 0 then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.criterion_events
      (company_id, conversation_id, criterion_key, kind, confidence,
       segment_id, quote, quote_start, quote_end, detector, model)
    values
      (v_company_id, p_conversation_id, v_event->>'criterion_key', v_kind,
       least(greatest((v_event->>'confidence')::double precision, 0), 1),
       (v_event->>'segment_id')::uuid, v_quote, v_offset - 1,
       v_offset - 1 + length(v_quote),
       coalesce(v_event->>'detector', 'unknown'),
       coalesce(v_event->>'model', 'unknown'))
    on conflict do nothing;

    if found then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'rejected', v_rejected);
end;
$$;

create or replace function public.start_live_conversation(
  p_title             text,
  p_engagement_type   text    default 'discovery',
  p_criteria_version  integer default 1,
  p_company_id        uuid    default null,
  p_consent_statement text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_statement  text := nullif(trim(coalesce(p_consent_statement, '')), '');
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'start_live_conversation: not a member of that company'
      using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'start_live_conversation: a title is required'
      using errcode = '22023';
  end if;
  if v_statement is null then
    raise exception 'start_live_conversation: confirm that everyone on the call agreed to be recorded'
      using errcode = '22023';
  end if;

  -- occurred_at is now: a live call is happening, which is the one case where
  -- the product knows when a conversation took place without being told.
  -- source_key stays null (nothing was imported); captured_live says this is
  -- the one kind of call lines may be appended to.
  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version,
     consent_statement, consent_confirmed_by, consent_confirmed_at, added_by, captured_live)
  values
    (v_company_id, trim(p_title), now(), p_engagement_type, p_criteria_version,
     v_statement,
     case when v_statement is not null then auth.uid() end,
     case when v_statement is not null then now() end,
     auth.uid(), true)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.append_live_segment(
  p_conversation_id uuid,
  p_speaker         text,
  p_start_ms        integer,
  p_end_ms          integer,
  p_text            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_live       boolean;
  v_added_by   uuid;
  v_created    timestamptz;
begin
  select c.company_id, c.captured_live, c.added_by, c.created_at
    into v_company_id, v_live, v_added_by, v_created
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'append_live_segment: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'append_live_segment: not a member of that company'
      using errcode = '42501';
  end if;
  -- Only onto a live call, by whoever is capturing it, while it could still
  -- be going on. An imported transcript is what was said; nobody adds lines.
  if not v_live or v_added_by is distinct from (select auth.uid()) or v_created < now() - interval '12 hours' then
    raise exception 'append_live_segment: only the person capturing a live call adds to it'
      using errcode = '42501';
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'append_live_segment: empty utterance' using errcode = '22023';
  end if;

  insert into public.segments
    (company_id, conversation_id, speaker, start_ms, end_ms, text)
  values
    (v_company_id, p_conversation_id, p_speaker, p_start_ms, greatest(p_end_ms, p_start_ms), p_text)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Failures and usage only for the caller's own company
-- ---------------------------------------------------------------------------

create or replace function public.record_failure(
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
  v_id              uuid;
  v_company_id      uuid := p_company_id;
  v_conversation_id uuid := p_conversation_id;
begin
  -- A signed-in person records only for their own company; an account in no
  -- company records nothing (the service role, with no user, is the pipeline).
  if (select auth.uid()) is not null then
    v_company_id := coalesce(v_company_id, private.sole_company_of_caller());
    if v_company_id is null or not (select private.is_company_member(v_company_id)) then
      raise exception 'record_failure: not a member of that company'
        using errcode = '42501';
    end if;
  end if;
  -- A call named must be that company's, or it is not named: usage against
  -- another company's call would read as its work (conversation_pipeline).
  if v_conversation_id is not null and not exists (
    select 1 from public.conversations c
     where c.id = v_conversation_id and c.company_id is not distinct from v_company_id
  ) then
    v_conversation_id := null;
  end if;

  insert into public.system_failures
    (company_id, conversation_id, source, kind, tier, model, status, message)
  values
    (v_company_id, v_conversation_id, p_source, p_kind, p_tier, p_model, p_status,
     left(coalesce(nullif(trim(p_message), ''), 'no message'), 2000))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_model_usage(
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
  v_id              uuid;
  v_company_id      uuid := p_company_id;
  v_conversation_id uuid := p_conversation_id;
begin
  -- A signed-in person records only for their own company; an account in no
  -- company records nothing (the service role, with no user, is the pipeline).
  if (select auth.uid()) is not null then
    v_company_id := coalesce(v_company_id, private.sole_company_of_caller());
    if v_company_id is null or not (select private.is_company_member(v_company_id)) then
      raise exception 'record_model_usage: not a member of that company'
        using errcode = '42501';
    end if;
  end if;
  -- A call named must be that company's, or it is not named: usage against
  -- another company's call would read as its work (conversation_pipeline).
  if v_conversation_id is not null and not exists (
    select 1 from public.conversations c
     where c.id = v_conversation_id and c.company_id is not distinct from v_company_id
  ) then
    v_conversation_id := null;
  end if;

  insert into public.model_usage
    (company_id, conversation_id, tier, model, detector,
     input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, duration_ms)
  values
    (v_company_id, v_conversation_id, p_tier, p_model, p_detector,
     coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
     coalesce(p_cache_creation_tokens, 0), coalesce(p_cache_read_tokens, 0), p_duration_ms)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Not a support session as another operator
-- ---------------------------------------------------------------------------

create or replace function public.open_support_access(
  p_subject_user_id uuid,
  p_reason          text,
  p_minutes         integer default 30
)
returns public.support_access
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_row public.support_access;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'open_support_access: not a platform admin'
      using errcode = '42501';
  end if;

  if p_subject_user_id = v_admin then
    raise exception 'open_support_access: that is you'
      using errcode = '22023';
  end if;

  -- Another operator's account is not a customer's: acting as them would be
  -- acting as an operator under someone else's name.
  if exists (select 1 from public.platform_admins a where a.user_id = p_subject_user_id) then
    raise exception 'open_support_access: that is an operator''s account'
      using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_subject_user_id) then
    raise exception 'open_support_access: no such account'
      using errcode = '22023';
  end if;

  if p_minutes < 1 or p_minutes > 240 then
    raise exception 'open_support_access: minutes must be between 1 and 240'
      using errcode = '22023';
  end if;

  insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at)
  values (v_admin, p_subject_user_id, p_reason, now() + make_interval(mins => p_minutes))
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Someone who has left a company no longer writes there
-- ---------------------------------------------------------------------------

create or replace function public.edit_segment_note(p_note_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then
    raise exception 'edit_segment_note: a note is 1 to 2000 characters' using errcode = '22023';
  end if;
  update public.segment_notes n
     set body = trim(p_body), updated_at = now()
   where n.id = p_note_id and n.author = (select auth.uid())
     and (select private.is_company_member(n.company_id));
  if not found then
    raise exception 'edit_segment_note: only its author can change a note' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.withdraw_dispute(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.criterion_events e
   where e.id = p_event_id
     and e.detector = 'person'
     and (select private.is_company_member(e.company_id))
     and (e.recorded_by = (select auth.uid())
          or exists (select 1 from public.company_members m
                      where m.company_id = e.company_id
                        and m.user_id = (select auth.uid())
                        and m.role = 'owner'));
  if not found then
    raise exception 'withdraw_dispute: only whoever made a correction, or an owner, can withdraw it' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.complete_coaching(p_assignment_id uuid, p_reply text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.coaching_assignments;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  select * into v_row from public.coaching_assignments a where a.id = p_assignment_id;
  if v_row.id is null or v_row.assigned_to <> (select auth.uid())
     or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'complete_coaching: only the person it was assigned to can mark it done' using errcode = '42501';
  end if;
  if v_reply is not null and length(v_reply) > 1000 then
    raise exception 'complete_coaching: a reply is at most 1000 characters' using errcode = '22023';
  end if;
  update public.coaching_assignments
     set status = 'done', done_at = now(), reply = v_reply
   where id = p_assignment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 (continued). Preps age out with retention
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_conversations(
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
  v_preps   integer := 0;
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

  -- A prep is about a person, and some of it came from the web: it goes when
  -- a call from the same day would.
  delete from public.call_preps p
   using public.companies co
   where co.id = p.company_id
     and co.retention_days is not null
     and (p_company_id is null or p.company_id = p_company_id)
     and coalesce(p.call_at, p.created_at) < now() - make_interval(days => co.retention_days);
  get diagnostics v_preps = row_count;

  return jsonb_build_object('erased', v_erased, 'preps', v_preps);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Erasing a call clears what that customer's preps said from it
-- ---------------------------------------------------------------------------

-- A brief quotes what the customer said on earlier calls, and the call is
-- where those words were. Clearing the customer's briefs (a brief can be
-- written again) and the lessons taken from them is the only way to be sure
-- none of the erased call's words are left.
create function private.forget_call_in_preps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_id is not null then
    delete from public.ai_guidance g
     using public.call_preps p
     where g.prep_id = p.id and p.company_id = old.company_id and p.account_id = old.account_id;
    update public.call_preps
       set brief = null, brief_model = null, brief_at = null
     where company_id = old.company_id and account_id = old.account_id and brief is not null;
  end if;
  return old;
end;
$$;

create trigger conversations_forget_in_preps
  after delete on public.conversations
  for each row execute function private.forget_call_in_preps();


-- ---------------------------------------------------------------------------
-- 7. A closed company keeps nothing it taught the AI
-- ---------------------------------------------------------------------------

create function private.forget_guidance_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.ai_guidance where company_id = new.id;
    delete from public.scorecard_purposes where company_id = new.id;
    delete from public.criterion_goals where company_id = new.id;
  end if;
  return new;
end;
$$;

create trigger companies_forget_guidance_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_guidance_on_close();
