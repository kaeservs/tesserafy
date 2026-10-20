-- Security review, 2026-10-19 (docs/engineering/security-review-2026-10-19.md).
--
--   1. A support window ends in the database, and ends what it started.
--      20261103090000_qa_fixes.sql ended a window at "End now", so a session
--      begun after it was taken for the customer's own. But the sign-in link
--      the console minted with the window lives for Auth's email-link expiry
--      (an hour), and opening it after End gave a session that was neither a
--      support session nor signed out: no banner, every refusal passed, the
--      password settable. That migration had not reached production; this one
--      replaces it before it does.
--        - A session counts as the window's if it began between the window
--          opening and the later of its expiry and the link's own expiry,
--          until the window's sign-ins are revoked.
--        - Revoking (End, or the sweep below once a window expires) deletes
--          the account's unused sign-in link and every session begun since
--          the window opened. After that the link cannot be opened, so a
--          later sign-in really is the customer's own.
--        - A window still open claims a session that began inside it, so a
--          second support session is not signed out for the first's sake.
--        - While a window's sign-ins are live, the account's password and
--          email cannot change at all: the web app refused a support session
--          the password form, but Auth's own API took the change directly.
--   2. A support session refuses what only the customer should do: plans,
--      retention, erasing, exports, trackers, the CRM, members, deletion,
--      scorecards, screen assist and the recording agreement. Only six
--      functions asked before.
--   3. Attendees and embeddings are written onto a call only by someone who
--      may change it.
--   4. The follow-up email is sent only on a paid plan, and a person sends at
--      most forty a day, however it is asked.
--   5. Provisioning refuses an operator's account and an account nobody
--      confirmed.
--   6. import_conversation bounds its text, as the route already did.
--   7. Only an owner dates a call past the company's retention, which erases
--      it that night.
--   8. request_early_access, unused since the early-access form went, is no
--      longer callable.
--   9. A failure row says who recorded it, and keeps a model name only if it
--      is one: Health prints it into a public log.
--  10. Two private helpers are no longer executable by PUBLIC.


-- 1 ---------------------------------------------------------------------------

alter table public.support_access add column revoked_at timestamptz;
comment on column public.support_access.revoked_at is
  'When the window''s sign-ins were revoked: its unused link and every session begun inside it. Set by end_support_access, or by the sweep once the window is over.';

-- Where a window's sessions stop counting as its own: the later of its expiry
-- and its link's (Auth's email-link expiry, an hour, as config.toml and the
-- hosted project's default have it; raise this if that is raised), or the
-- moment its sign-ins were revoked, whichever comes first.
create function private.support_span_end(p_created timestamptz, p_expires timestamptz, p_revoked timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select least(greatest(p_expires, p_created + interval '1 hour'), coalesce(p_revoked, 'infinity'::timestamptz));
$$;
revoke all on function private.support_span_end(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Windows over before this migration, whose links have expired too: nothing
-- of theirs is left to revoke.
update public.support_access a
   set revoked_at = greatest(coalesce(a.ended_at, a.expires_at), a.created_at + interval '1 hour')
 where (a.ended_at is not null or a.expires_at <= now())
   and greatest(coalesce(a.ended_at, a.expires_at), a.created_at + interval '1 hour') <= now();

create or replace function public.support_session_ended()
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
       and s.created_at <= private.support_span_end(a.created_at, a.expires_at, a.revoked_at)
       and (a.ended_at is not null or a.expires_at <= now())
       -- A window still open that began before this session claims it: a
       -- second support session is that window's, not one left over.
       and not exists (
         select 1 from public.support_access o
          where o.subject_user_id = s.user_id
            and o.ended_at is null and o.expires_at > now()
            and o.created_at <= s.created_at
       )
  );
$$;

create or replace function private.in_support_session()
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
       and s.created_at <= private.support_span_end(a.created_at, a.expires_at, a.revoked_at)
  );
$$;
revoke all on function private.in_support_session() from public, anon;

-- What a window started, ended: the link the console minted with it, if it
-- was never opened, and every session begun since the window opened — the
-- support session, a late use of the link, and any the customer started
-- meanwhile (they sign in again). Deleting a session revokes its refresh
-- token; its access token lives out its hour. If Auth's tables cannot be
-- touched, the window is left unrevoked and its span keeps counting the
-- link's whole life, so nothing it started passes for the customer's own.
create function private.revoke_support_sign_ins(p_access_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.support_access;
begin
  select * into v_access from public.support_access a where a.id = p_access_id for update;
  if v_access.id is null or v_access.revoked_at is not null then
    return;
  end if;
  begin
    delete from auth.one_time_tokens t where t.user_id = v_access.subject_user_id;
    update auth.users u set recovery_token = ''
     where u.id = v_access.subject_user_id and coalesce(u.recovery_token, '') <> '';
    delete from auth.sessions s
     where s.user_id = v_access.subject_user_id
       and s.created_at >= v_access.created_at;
  exception when insufficient_privilege then
    raise warning 'revoke_support_sign_ins: % (support_access %)', sqlerrm, v_access.id;
    return;
  end;
  update public.support_access set revoked_at = now() where id = v_access.id;
end;
$$;
revoke all on function private.revoke_support_sign_ins(uuid) from public, anon, authenticated;

-- Every window that is over and not yet revoked. Run each minute, so a window
-- that simply runs out ends what it started within a minute of its expiry.
create function private.close_support_windows()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select a.id from public.support_access a
     where a.revoked_at is null and (a.ended_at is not null or a.expires_at <= now())
  loop
    perform private.revoke_support_sign_ins(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.close_support_windows() from public, anon, authenticated;

select cron.schedule('close-support-windows', '* * * * *', $$select private.close_support_windows()$$);

create or replace function public.end_support_access(p_id uuid)
returns public.support_access
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.support_access;
begin
  update public.support_access
     set ended_at = now()
   where id = p_id
     and admin_user_id = (select auth.uid())
     and ended_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'end_support_access: no open session of yours with that id'
      using errcode = '42501';
  end if;

  perform private.revoke_support_sign_ins(v_row.id);
  select * into v_row from public.support_access a where a.id = v_row.id;
  return v_row;
end;
$$;

-- While a window's sign-ins are live, the account's credentials stay as they
-- are: a support session could otherwise set the password, or move the
-- account to another address, through Auth's own API, which the web app's
-- refusal never sees. The customer's own change waits for the window too.
create function private.refuse_credential_change_in_support()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.encrypted_password is distinct from old.encrypted_password
      or new.email is distinct from old.email
      or new.email_change is distinct from old.email_change)
     and exists (
       select 1 from public.support_access a
        where a.subject_user_id = new.id
          and a.created_at <= now()
          and now() < private.support_span_end(a.created_at, a.expires_at, a.revoked_at)
     ) then
    raise exception 'a support window is open on this account: its password and email change after it ends'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_credential_change_in_support() from public, anon, authenticated;

create trigger refuse_credential_change_in_support
  before update on auth.users
  for each row execute function private.refuse_credential_change_in_support();

-- 2 ---------------------------------------------------------------------------

-- One refusal, called first by every function below. Each body is otherwise
-- its latest definition, unchanged.
create function private.refuse_support_session(p_function text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.in_support_session()) then
    raise exception '%: a support session cannot do this in the customer''s name', p_function
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.refuse_support_session(text) from public, anon;

create or replace function public.change_plan(p_plan text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_current    public.plans;
  v_target     public.plans;
begin
  perform private.refuse_support_session('change_plan');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'change_plan: only an owner can change the plan' using errcode = '42501';
  end if;

  perform private.roll_subscription(v_company_id);
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select p.* into v_current from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  select * into v_target from public.plans where id = p_plan;

  if v_target.id is null or not v_target.self_serve then
    raise exception 'change_plan: choose Starter, Pro or Incognito' using errcode = '22023';
  end if;
  if v_current.id in ('pilot', 'internal') then
    raise exception 'change_plan: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;
  if v_sub.provider = 'stripe' then
    raise exception 'change_plan: you pay through Stripe; change the plan in billing' using errcode = '22023';
  end if;

  -- From nothing, Free or the trial: a paid period starts now — through
  -- checkout once payments are on.
  if v_current.id in ('none', 'free', 'trial') then
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
    perform private.apply_plan(v_company_id, v_target.id, 'started', 'owner', v_uid);
    return 'started';
  end if;

  -- The plan they already have: this is undoing a pending cancel or downgrade.
  if v_target.id = v_current.id then
    if not v_sub.cancel_at_period_end and v_sub.scheduled_plan is null then
      raise exception 'change_plan: you are already on %', v_target.name using errcode = '22023';
    end if;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'change_undone', v_current.id, v_current.id, 'owner', v_uid);
    return 'kept';
  end if;

  -- Up: now, and within the same period — more allowance straight away.
  if v_target.rank > v_current.rank then
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
    update public.companies set plan = v_target.id where id = v_company_id;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'upgraded', v_current.id, v_target.id, 'owner', v_uid);
    return 'upgraded';
  end if;

  -- Down: at the end of the period they have, which is what they have had.
  update public.subscriptions
     set scheduled_plan = v_target.id, cancel_at_period_end = false, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'downgrade_scheduled', v_current.id, v_target.id, 'owner', v_uid);
  return 'downgrade_scheduled';
end;
$$;

create or replace function public.cancel_plan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_plan       public.plans;
begin
  perform private.refuse_support_session('cancel_plan');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'cancel_plan: only an owner can cancel' using errcode = '42501';
  end if;
  if exists (select 1 from public.subscriptions s where s.company_id = v_company_id and s.provider = 'stripe') then
    raise exception 'cancel_plan: you pay through Stripe; cancel in billing' using errcode = '22023';
  end if;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.self_serve then
    raise exception 'cancel_plan: there is no paid plan to cancel' using errcode = '22023';
  end if;

  update public.subscriptions
     set cancel_at_period_end = true, scheduled_plan = null, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'cancel_scheduled', v_plan.id, 'free', 'owner', v_uid);
end;
$$;

create or replace function public.set_retention(p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  perform private.refuse_support_session('set_retention');
  if not exists (
    select 1 from public.company_members m
    where m.company_id = v_company_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  ) then
    raise exception 'set_retention: only an owner may set retention' using errcode = '42501';
  end if;

  if p_days is not null and (p_days < 7 or p_days > 3650) then
    raise exception 'set_retention: retention must be between 7 and 3650 days, or none'
      using errcode = '22023';
  end if;

  update public.companies set retention_days = p_days where id = v_company_id;
  return p_days;
end;
$$;

create or replace function public.erase_conversation(p_conversation_id uuid, p_reason text DEFAULT 'request'::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_uid        uuid := (select auth.uid());
begin
  perform private.refuse_support_session('erase_conversation');
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

  -- What the log says is not the caller's to choose: an owner's erasure is
  -- their request; only the purge and operator scripts name another reason.
  return private.erase_conversation_as(p_conversation_id, case when v_uid is null then p_reason else 'request' end, v_uid);
end;
$$;

create or replace function public.connect_tracker(p_provider text, p_target text, p_token_ciphertext text, p_token_hint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  perform private.refuse_support_session('connect_tracker');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'connect_tracker: only an owner can connect a tracker' using errcode = '42501';
  end if;

  insert into public.tracker_events (company_id, action, provider, target, actor)
  values (v_company_id, 'connected', p_provider, p_target, (select auth.uid()));

  insert into public.company_trackers (company_id, provider, target, token_ciphertext, token_hint, connected_by)
  values (v_company_id, p_provider, p_target, p_token_ciphertext, p_token_hint, (select auth.uid()))
  on conflict (company_id) do update
     set provider = excluded.provider,
         target = excluded.target,
         token_ciphertext = excluded.token_ciphertext,
         token_hint = excluded.token_hint,
         connected_by = excluded.connected_by,
         connected_at = now();
end;
$$;

create or replace function public.disconnect_tracker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_row public.company_trackers;
begin
  perform private.refuse_support_session('disconnect_tracker');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'disconnect_tracker: only an owner can disconnect a tracker' using errcode = '42501';
  end if;

  delete from public.company_trackers where company_id = v_company_id returning * into v_row;
  if v_row.company_id is null then
    raise exception 'disconnect_tracker: no tracker is connected' using errcode = '22023';
  end if;

  insert into public.tracker_events (company_id, action, provider, target, actor)
  values (v_company_id, 'disconnected', v_row.provider, v_row.target, (select auth.uid()));
end;
$$;

create or replace function public.record_company_export()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_id         uuid;
begin
  perform private.refuse_support_session('record_company_export');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'record_company_export: only an owner can export the company''s data'
      using errcode = '42501';
  end if;

  insert into public.company_exports (company_id, user_id, email, conversations)
  select v_company_id, v_uid, u.email,
         (select count(*)::integer from public.conversations c where c.company_id = v_company_id)
    from auth.users u where u.id = v_uid
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.tracker_for_ticket(p_insight_id uuid)
returns TABLE(provider text, target text, token_ciphertext text, company_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_status text;
begin
  perform private.refuse_support_session('tracker_for_ticket');
  select i.company_id, i.status into v_company_id, v_status
    from public.insights i where i.id = p_insight_id;

  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'tracker_for_ticket: insight not found' using errcode = '42501';
  end if;
  if v_status <> 'approved' then
    raise exception 'tracker_for_ticket: the insight is %; approve it first', v_status using errcode = '22023';
  end if;

  return query
    select t.provider, t.target, t.token_ciphertext, t.company_id
      from public.company_trackers t where t.company_id = v_company_id;
end;
$$;

create or replace function public.disconnect_crm()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_row public.company_crms;
begin
  perform private.refuse_support_session('disconnect_crm');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'disconnect_crm: only an owner can disconnect a CRM' using errcode = '42501';
  end if;

  delete from public.company_crms where company_id = v_company_id returning * into v_row;
  if v_row.company_id is null then
    raise exception 'disconnect_crm: no CRM is connected' using errcode = '22023';
  end if;

  insert into public.crm_events (company_id, action, provider, account_ref, actor)
  values (v_company_id, 'disconnected', v_row.provider, v_row.account_ref, (select auth.uid()));
end;
$$;

create or replace function public.remove_company_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_role       text;
  v_email      text;
begin
  perform private.refuse_support_session('remove_company_member');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'remove_company_member: only an owner can remove someone' using errcode = '42501';
  end if;

  -- Not yourself. That rule is also what keeps a company from losing its last
  -- owner: removing another owner leaves you, and you are one.
  if p_user_id = (select auth.uid()) then
    raise exception 'remove_company_member: you cannot remove yourself' using errcode = '22023';
  end if;

  select m.role, u.email into v_role, v_email
    from public.company_members m
    join auth.users u on u.id = m.user_id
   where m.company_id = v_company_id and m.user_id = p_user_id;

  -- Same answer whether they are in another company or nowhere: an owner
  -- learns nothing about accounts outside their own company.
  if v_role is null then
    raise exception 'remove_company_member: not in your company' using errcode = '22023';
  end if;

  insert into public.membership_removals (company_id, user_id, email, role, removed_by)
  values (v_company_id, p_user_id, v_email, v_role, (select auth.uid()));

  delete from public.company_members
   where company_id = v_company_id and user_id = p_user_id;
end;
$$;

create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  perform private.refuse_support_session('set_member_role');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'set_member_role: only an owner can change someone''s role' using errcode = '42501';
  end if;

  perform private.set_member_role(v_company_id, p_user_id, p_role, (select auth.uid()));
exception
  when sqlstate '22023' then
    raise exception 'set_member_role: %', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.delete_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  perform private.refuse_support_session('delete_account');
  select a.company_id into v_company_id from public.accounts a where a.id = p_account_id;
  if v_company_id is null or not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'delete_account: only an owner can delete an account' using errcode = '42501';
  end if;
  delete from public.accounts where id = p_account_id;
end;
$$;

create or replace function public.delete_knowledge_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents;
begin
  perform private.refuse_support_session('delete_knowledge_document');
  select * into v_doc from public.knowledge_documents d where d.id = p_document_id;
  if v_doc.id is null or not (select private.is_company_member(v_doc.company_id)) then
    raise exception 'delete_knowledge_document: document not found' using errcode = 'P0002';
  end if;
  if not private.is_company_owner_of_document(v_doc) then
    raise exception 'delete_knowledge_document: only an owner deletes from the company''s knowledge' using errcode = '42501';
  end if;
  delete from public.knowledge_documents where id = v_doc.id;
end;
$$;

create or replace function public.publish_scorecard(p_engagement_type text, p_criteria jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_uid        uuid := (select auth.uid());
  v_version    integer;
  v_item       jsonb;
  v_position   integer := 0;
  v_keys       text[] := '{}';
  v_key        text;
  v_label      text;
  v_definition text;
  v_weight     double precision;
  v_candidate  double precision;
  v_confirm    double precision;
  v_segments   integer;
begin
  perform private.refuse_support_session('publish_scorecard');
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'publish_scorecard: only an owner can publish a scorecard' using errcode = '42501';
  end if;

  if p_engagement_type is null or p_engagement_type !~ '^[a-z][a-z0-9-]{1,39}$' then
    raise exception 'publish_scorecard: a scorecard''s name is 2 to 40 lower-case letters, digits and hyphens'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.criteria_definitions d
     where d.company_id is null and d.engagement_type = p_engagement_type
  ) then
    raise exception 'publish_scorecard: that is the name of a Tesserafy template; choose another'
      using errcode = '22023';
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array'
     or jsonb_array_length(p_criteria) < 2 or jsonb_array_length(p_criteria) > 12 then
    raise exception 'publish_scorecard: a scorecard has 2 to 12 criteria' using errcode = '22023';
  end if;

  select coalesce(max(d.version), 0) + 1 into v_version
    from public.criteria_definitions d
   where d.company_id = v_company_id and d.engagement_type = p_engagement_type;

  for v_item in select * from jsonb_array_elements(p_criteria)
  loop
    v_position   := v_position + 1;
    v_key        := v_item->>'key';
    v_label      := trim(coalesce(v_item->>'label', ''));
    v_definition := trim(coalesce(v_item->>'definition', ''));
    v_weight     := coalesce((v_item->>'weight')::double precision, 1);
    v_candidate  := coalesce((v_item->>'candidate_threshold')::double precision, 0.55);
    v_confirm    := coalesce((v_item->>'confirm_threshold')::double precision, 0.8);
    v_segments   := coalesce((v_item->>'corroborating_segments')::integer, 2);

    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,39}$' or v_key = any (v_keys) then
      raise exception 'publish_scorecard: criterion % needs its own key of lower-case letters, digits and underscores', v_position
        using errcode = '22023';
    end if;
    if length(v_label) < 1 or length(v_label) > 60 then
      raise exception 'publish_scorecard: criterion %''s name is 1 to 60 characters', v_position using errcode = '22023';
    end if;
    if length(v_definition) < 20 or length(v_definition) > 600 then
      raise exception 'publish_scorecard: criterion %''s description is 20 to 600 characters — it is what the detector listens for', v_position
        using errcode = '22023';
    end if;
    if v_weight < 0.5 or v_weight > 3 then
      raise exception 'publish_scorecard: criterion %''s weight is between 0.5 and 3', v_position using errcode = '22023';
    end if;
    if v_candidate <= 0 or v_candidate > v_confirm or v_confirm > 1 or v_segments < 1 or v_segments > 5 then
      raise exception 'publish_scorecard: criterion %''s thresholds are out of range', v_position using errcode = '22023';
    end if;

    v_keys := v_keys || v_key;
    insert into public.criteria_definitions
      (company_id, engagement_type, version, key, label, definition, weight,
       candidate_threshold, confirm_threshold, corroborating_segments, position, published_by)
    values
      (v_company_id, p_engagement_type, v_version, v_key, v_label, v_definition, v_weight,
       v_candidate, v_confirm, v_segments, v_position, v_uid);
  end loop;

  return v_version;
end;
$$;

create or replace function public.request_account_deletion(p_confirm_email text)
returns account_deletion_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_email   text;
  v_company uuid;
  v_role    text;
  v_row     public.account_deletion_requests;
begin
  perform private.refuse_support_session('request_account_deletion');
  if v_uid is null then
    raise exception 'request_account_deletion: not signed in' using errcode = '42501';
  end if;

  select u.email::text into v_email from auth.users u where u.id = v_uid;
  if v_email is null or lower(trim(coalesce(p_confirm_email, ''))) <> lower(v_email) then
    raise exception 'request_account_deletion: type your address exactly as you sign in with it'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.platform_admins a where a.user_id = v_uid) then
    raise exception 'request_account_deletion: an operator''s account is removed by another operator'
      using errcode = '22023';
  end if;

  select * into v_row from public.account_deletion_requests r
   where r.user_id = v_uid and r.resolved_at is null;
  if v_row.id is not null then
    return v_row;
  end if;

  select m.company_id, m.role into v_company, v_role
    from public.company_members m where m.user_id = v_uid limit 1;

  if v_role = 'owner' then
    raise exception 'request_account_deletion: an owner cannot leave this way; make someone else an owner under Settings, step down to member, then ask again — or, if you are the only person in the company, ask Tesserafy to close it'
      using errcode = '22023';
  end if;

  if v_company is not null then
    insert into public.membership_removals (company_id, user_id, email, role, removed_by)
    values (v_company, v_uid, v_email, v_role, v_uid);
    delete from public.company_members where company_id = v_company and user_id = v_uid;
  end if;

  insert into public.account_deletion_requests (user_id, company_id)
  values (v_uid, v_company)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_screen_assist(p_allowed boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  perform private.refuse_support_session('set_screen_assist');
  if not private.is_company_owner(v_company_id) then
    raise exception 'set_screen_assist: only an owner decides this' using errcode = '42501';
  end if;
  if p_allowed is null then
    raise exception 'set_screen_assist: on or off' using errcode = '22023';
  end if;
  update public.companies set screen_assist = p_allowed where id = v_company_id;
  return p_allowed;
end;
$$;

create or replace function public.agree_to_recording(p_terms_version text, p_statement text, p_surface text)
returns timestamp with time zone
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_at         timestamptz;
begin
  perform private.refuse_support_session('agree_to_recording');
  if v_uid is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'agree_to_recording: not a member of a company' using errcode = '42501';
  end if;
  insert into public.recording_agreements (user_id, email, company_id, terms_version, statement, surface)
  values (v_uid, (select u.email from auth.users u where u.id = v_uid), v_company_id,
          trim(p_terms_version), trim(p_statement), p_surface)
  on conflict (user_id, company_id, terms_version) do nothing;
  select a.agreed_at into v_at from public.recording_agreements a
   where a.user_id = v_uid and a.company_id = v_company_id and a.terms_version = trim(p_terms_version);
  return v_at;
end;
$$;


-- 3 ---------------------------------------------------------------------------

create or replace function public.link_call_to_meeting(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_call     public.conversations;
  v_at       timestamptz;
  v_event    public.calendar_events;
  v_count    integer;
  v_account  uuid;
begin
  select * into v_call from public.conversations c where c.id = p_conversation_id;
  if v_uid is null or v_call.id is null or not (select private.is_company_member(v_call.company_id)) then
    raise exception 'link_call_to_meeting: call not found' using errcode = 'P0002';
  end if;
  -- Attendees go on the call from the caller's own calendar, so only someone
  -- who may change the call puts them there (security review, 2026-10-19).
  if not private.may_edit_conversation(v_call.company_id, v_call.added_by) then
    raise exception 'link_call_to_meeting: only an owner, or whoever added the call, can link it'
      using errcode = '42501';
  end if;
  v_at := coalesce(v_call.occurred_at, v_call.created_at);

  -- The caller's own meeting at that time: under way, or about to start.
  select * into v_event from public.calendar_events e
   where e.user_id = v_uid and e.company_id = v_call.company_id
     and e.starts_at - interval '15 minutes' <= v_at and v_at <= e.ends_at
   order by abs(extract(epoch from (e.starts_at - v_at)))
   limit 1;
  if v_event.id is null then
    return 0;
  end if;

  insert into public.call_attendees (company_id, conversation_id, email, name, meeting_title)
  select v_call.company_id, v_call.id, lower(trim(a ->> 'email')), left(nullif(trim(a ->> 'name'), ''), 200), left(v_event.title, 300)
    from jsonb_array_elements(v_event.attendees) as a
   where coalesce(a ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(a ->> 'email') <= 320
  on conflict (conversation_id, email) do nothing;
  get diagnostics v_count = row_count;

  if v_call.account_id is null then
    select acc.id into v_account
      from public.call_attendees t
      join public.accounts acc
        on acc.company_id = v_call.company_id and lower(acc.domain) = split_part(t.email, '@', 2)
     where t.conversation_id = v_call.id
     limit 1;
    if v_account is not null then
      update public.conversations set account_id = v_account where id = v_call.id;
    end if;
  end if;
  return v_count;
end;
$$;

create or replace function public.record_segment_embeddings(p_conversation_id uuid, p_model text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_added_by   uuid;
  v_written    integer;
begin
  select c.company_id, c.added_by into v_company_id, v_added_by
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'record_segment_embeddings: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_segment_embeddings: not a member of that company'
      using errcode = '42501';
  end if;
  -- Only the import that made the call embeds it; a colleague overwriting
  -- its vectors changed what search and Ask find (security review, 2026-10-19).
  if not private.may_edit_conversation(v_company_id, v_added_by) then
    raise exception 'record_segment_embeddings: only an owner, or whoever added the call, can embed it'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_model), '') = '' or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'record_segment_embeddings: a model and an array of rows are required'
      using errcode = '22023';
  end if;

  -- The cast to vector(384) rejects a vector of any other length, which is
  -- the check that matters: a 768-dimension vector from the old model
  -- written here would fail loudly rather than sit unsearchable.
  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select s.id, s.company_id, (r->>'embedding')::extensions.vector(384), p_model
  from jsonb_array_elements(p_rows) as r
  join public.segments s
    on s.id = (r->>'segment_id')::uuid
   and s.conversation_id = p_conversation_id
  on conflict (segment_id) do update
    set embedding = excluded.embedding,
        model     = excluded.model;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;


-- 4 ---------------------------------------------------------------------------

create or replace function public.begin_follow_up_send(p_conversation_id uuid, p_from_name text, p_recipients text[], p_subject text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid;
  v_email      text;
  v_to         text[];
  v_id         uuid;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_uid is null or v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'begin_follow_up_send: call not found' using errcode = 'P0002';
  end if;
  if (select private.in_support_session()) then
    raise exception 'begin_follow_up_send: a support session does not send email in the customer''s name'
      using errcode = '42501';
  end if;
  -- Sending goes out from Tesserafy's domain with words the seller chose, so it
  -- is for paying companies: on the trial, Copy and "Open in your email app"
  -- are the way (security review, 2026-10-19).
  if coalesce((select c.plan from public.companies c where c.id = v_company_id), 'none') in ('free', 'trial', 'none') then
    raise exception 'begin_follow_up_send: sending from Tesserafy is on paid plans' using errcode = '0A000';
  end if;
  if not exists (select 1 from public.follow_ups f where f.conversation_id = p_conversation_id) then
    raise exception 'begin_follow_up_send: draft the follow-up first' using errcode = 'P0002';
  end if;

  select array_agg(distinct lower(trim(r))) into v_to from unnest(p_recipients) r where trim(r) <> '';
  if v_to is null or cardinality(v_to) > 10
     or exists (select 1 from unnest(v_to) r where r !~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$' or length(r) > 320) then
    raise exception 'begin_follow_up_send: one to ten email addresses' using errcode = '22023';
  end if;

  -- However it is asked, a company sends at most thirty an hour.
  if (select count(*) from public.follow_up_sends s
       where s.company_id = v_company_id and s.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'begin_follow_up_send: too many follow-ups sent this hour' using errcode = '54000';
  end if;
  -- And a person at most forty a day, the route's own limit, however it is asked.
  if (select count(*) from public.follow_up_sends s
       where s.sent_by = v_uid and s.created_at > now() - interval '1 day') >= 40 then
    raise exception 'begin_follow_up_send: too many follow-ups sent today' using errcode = '54000';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' then
    raise exception 'begin_follow_up_send: your account has no email address to reply to' using errcode = '22023';
  end if;

  insert into public.follow_up_sends
    (company_id, conversation_id, sent_by, from_name, reply_to, recipients, subject, body)
  values
    (v_company_id, p_conversation_id, v_uid, trim(p_from_name), v_email, v_to, trim(p_subject), p_body)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reply_to', v_email, 'recipients', to_jsonb(v_to));
end;
$$;


-- 5 ---------------------------------------------------------------------------

create or replace function public.open_account_provisioning(p_email text, p_role text, p_company_id uuid DEFAULT NULL::uuid, p_company_name text DEFAULT NULL::text, p_plan text DEFAULT 'pilot'::text)
returns account_provisioning
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := nullif(trim(coalesce(p_company_name, '')), '');
  v_existing uuid;
  v_row   public.account_provisioning;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'open_account_provisioning: not a platform admin' using errcode = '42501';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'open_account_provisioning: that is not an email address' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'open_account_provisioning: role is owner or member' using errcode = '22023';
  end if;
  if (p_company_id is null) = (v_name is null) then
    raise exception 'open_account_provisioning: name a new company or choose an existing one, not both'
      using errcode = '22023';
  end if;
  if v_name is not null and p_role <> 'owner' then
    raise exception 'open_account_provisioning: the first person in a new company is its owner'
      using errcode = '22023';
  end if;
  if v_name is not null and (p_plan is null or p_plan = 'none'
                             or not exists (select 1 from public.plans where id = p_plan)) then
    raise exception 'open_account_provisioning: plan is one of trial, basic, pro, pilot or internal' using errcode = '22023';
  end if;
  if p_company_id is not null
     and not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'open_account_provisioning: no such company' using errcode = '22023';
  end if;

  select u.id into v_existing from auth.users u where lower(u.email) = v_email;
  if v_existing is not null
     and exists (select 1 from public.company_members m where m.user_id = v_existing) then
    raise exception 'open_account_provisioning: % already belongs to a company', v_email
      using errcode = '22023';
  end if;
  -- Another operator's account is not a customer's, as open_support_access
  -- already says (security review, 2026-10-19).
  if v_existing is not null and exists (select 1 from public.platform_admins a where a.user_id = v_existing) then
    raise exception 'open_account_provisioning: that is an operator''s account' using errcode = '22023';
  end if;
  -- An account nobody confirmed may have been made by someone else, with a
  -- password they know, before the real person was asked for: it is not
  -- handed a company.
  if v_existing is not null
     and exists (select 1 from auth.users u where u.id = v_existing and u.email_confirmed_at is null) then
    raise exception 'open_account_provisioning: % has an account that was never confirmed; delete it first', v_email
      using errcode = '22023';
  end if;

  insert into public.account_provisioning (admin_user_id, email, role, company_id, company_name, plan)
  values ((select auth.uid()), v_email, p_role, p_company_id, v_name,
          case when v_name is not null then p_plan end)
  returning * into v_row;

  return v_row;
end;
$$;


-- 6 ---------------------------------------------------------------------------

create or replace function public.import_conversation(p_title text, p_segments jsonb, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_engagement_type text DEFAULT 'discovery'::text, p_criteria_version integer DEFAULT 1, p_company_id uuid DEFAULT NULL::uuid, p_consent_statement text DEFAULT NULL::text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_count      integer;
  v_statement  text := nullif(trim(coalesce(p_consent_statement, '')), '');
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'import_conversation: not a member of that company'
      using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'import_conversation: a title is required' using errcode = '22023';
  end if;
  if v_statement is null then
    raise exception 'import_conversation: confirm that everyone on the call agreed to be recorded'
      using errcode = '22023';
  end if;
  if length(v_statement) > 2000 then
    raise exception 'import_conversation: that consent statement is longer than any the app shows'
      using errcode = '22023';
  end if;
  if p_segments is null or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) = 0 then
    raise exception 'import_conversation: a transcript needs at least one segment'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_segments) > 5000 then
    raise exception 'import_conversation: % segments is more than a transcript',
      jsonb_array_length(p_segments)
      using errcode = '22023';
  end if;
  -- Bounded here, not only in the route: the function is callable directly
  -- (security review, 2026-10-19). Ten hours of speech is about 600,000
  -- characters.
  if exists (select 1 from jsonb_array_elements(p_segments) s where length(coalesce(s->>'text', '')) > 50000)
     or (select sum(length(coalesce(s->>'text', ''))) from jsonb_array_elements(p_segments) s) > 5000000 then
    raise exception 'import_conversation: a line, or the whole transcript, is longer than any call'
      using errcode = '22023';
  end if;

  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version,
     consent_statement, consent_confirmed_by, consent_confirmed_at, added_by)
  values
    (v_company_id, left(trim(p_title), 200), p_occurred_at, p_engagement_type, p_criteria_version,
     v_statement,
     case when v_statement is not null then auth.uid() end,
     case when v_statement is not null then now() end,
     auth.uid())
  returning id into v_id;

  insert into public.segments
    (company_id, conversation_id, speaker, start_ms, end_ms, text)
  select
    v_company_id,
    v_id,
    left(nullif(trim(coalesce(s->>'speaker', '')), ''), 80),
    greatest((s->>'startMs')::integer, 0),
    greatest((s->>'endMs')::integer, (s->>'startMs')::integer),
    s->>'text'
  from jsonb_array_elements(p_segments) as s
  where length(trim(coalesce(s->>'text', ''))) > 0;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'import_conversation: every segment was empty' using errcode = '22023';
  end if;

  return v_id;
end;
$$;


-- 7 ---------------------------------------------------------------------------

create or replace function public.edit_conversation(p_conversation_id uuid, p_title text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_clear_date boolean DEFAULT false, p_engagement_type text DEFAULT NULL::text, p_criteria_version integer DEFAULT NULL::integer, p_outcome text DEFAULT NULL::text, p_account_id uuid DEFAULT NULL::uuid, p_clear_account boolean DEFAULT false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.conversations;
  v_uid      uuid := (select auth.uid());
  v_changed  text[] := '{}';
  v_removed  integer := 0;
  v_title    text := nullif(trim(p_title), '');
  v_outcome  text;
  v_date     timestamptz;
  v_account  uuid;
begin
  select * into v_row from public.conversations c where c.id = p_conversation_id for update;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'edit_conversation: call not found' using errcode = 'P0002';
  end if;
  if not private.may_edit_conversation(v_row.company_id, v_row.added_by) then
    raise exception 'edit_conversation: only an owner, or whoever added the call, can change it'
      using errcode = '42501';
  end if;

  if p_title is not null then
    if v_title is null or length(v_title) > 200 then
      raise exception 'edit_conversation: a title is 1 to 200 characters' using errcode = '22023';
    end if;
    if v_title is distinct from v_row.title then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'title', v_row.title, v_title, v_uid);
      update public.conversations set title = v_title where id = v_row.id;
      v_changed := array_append(v_changed, 'title');
    end if;
  end if;

  if p_clear_date or p_occurred_at is not null then
    v_date := case when p_clear_date then null else p_occurred_at end;
    if v_date > now() + interval '1 day' then
      raise exception 'edit_conversation: a call cannot have happened in the future' using errcode = '22023';
    end if;
    -- A date past the company's retention is erased that night, with no
    -- record of who asked: deciding that is an owner's, as erasing is.
    if v_date is not null
       and exists (select 1 from public.companies co
                    where co.id = v_row.company_id and co.retention_days is not null
                      and v_date < now() - make_interval(days => co.retention_days))
       and not exists (select 1 from public.company_members m
                        where m.company_id = v_row.company_id and m.user_id = v_uid and m.role = 'owner') then
      raise exception 'edit_conversation: that date is past the company''s retention; only an owner can set it'
        using errcode = '42501';
    end if;
    if v_date is distinct from v_row.occurred_at then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'occurred_at', v_row.occurred_at::text, v_date::text, v_uid);
      update public.conversations set occurred_at = v_date where id = v_row.id;
      v_changed := array_append(v_changed, 'occurred_at');
    end if;
  end if;

  if p_engagement_type is not null or p_criteria_version is not null then
    if p_engagement_type is null or p_criteria_version is null then
      raise exception 'edit_conversation: a scorecard is a name and a version' using errcode = '22023';
    end if;
    if (p_engagement_type, p_criteria_version) is distinct from (v_row.engagement_type, v_row.criteria_version) then
      delete from public.criterion_events e where e.conversation_id = v_row.id;
      get diagnostics v_removed = row_count;
      -- The pinning trigger refuses a set that is neither a template nor this
      -- company's own (23503), and rolls the deletion back with it.
      update public.conversations
         set engagement_type = p_engagement_type, criteria_version = p_criteria_version
       where id = v_row.id;
      insert into public.conversation_edits
        (company_id, conversation_id, field, old_value, new_value, evidence_removed, actor)
      values (v_row.company_id, v_row.id, 'scorecard',
              v_row.engagement_type || ' v' || v_row.criteria_version,
              p_engagement_type || ' v' || p_criteria_version, v_removed, v_uid);
      v_changed := array_append(v_changed, 'scorecard');
    end if;
  end if;

  if p_outcome is not null then
    if p_outcome not in ('open', 'won', 'lost', 'unknown') then
      raise exception 'edit_conversation: an outcome is open, won, lost or unknown' using errcode = '22023';
    end if;
    v_outcome := nullif(p_outcome, 'unknown');
    if v_outcome is distinct from v_row.outcome then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'outcome', v_row.outcome, v_outcome, v_uid);
      update public.conversations
         set outcome = v_outcome,
             outcome_set_by = case when v_outcome is null then null else v_uid end,
             outcome_set_at = case when v_outcome is null then null else now() end
       where id = v_row.id;
      v_changed := array_append(v_changed, 'outcome');
    end if;
  end if;

  if p_clear_account or p_account_id is not null then
    v_account := case when p_clear_account then null else p_account_id end;
    if v_account is not null and not exists (
      select 1 from public.accounts a where a.id = v_account and a.company_id = v_row.company_id
    ) then
      raise exception 'edit_conversation: that account is not one of this company''s' using errcode = '22023';
    end if;
    if v_account is distinct from v_row.account_id then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'account',
              (select a.name from public.accounts a where a.id = v_row.account_id),
              (select a.name from public.accounts a where a.id = v_account), v_uid);
      update public.conversations set account_id = v_account where id = v_row.id;
      v_changed := array_append(v_changed, 'account');
    end if;
  end if;

  return jsonb_build_object('changed', to_jsonb(v_changed), 'evidence_removed', v_removed);
end;
$$;


-- 8 ---------------------------------------------------------------------------

-- The early-access form went on 2026-10-07; the function stayed callable by
-- anyone, and one visitor could fill its hourly cap for everybody.
revoke all on function public.request_early_access(text, text, text) from public, anon, authenticated;


-- 9 ---------------------------------------------------------------------------

-- Who recorded a failure: any member can record one for their own company, so
-- a row that raises the alarm (tenant_boundary alarms on the first) says whose
-- it was. A plain id, as ADR 0013 asks of a reference to an account.
alter table public.system_failures add column reported_by uuid;

-- Health prints the model into a public Actions log; a name it is not, a
-- line break and a workflow command included, is not kept.
alter table public.system_failures
  add constraint system_failures_model_is_a_name
  check (model is null or model ~ '^[a-z0-9.-]{1,64}$') not valid;

create or replace function public.record_failure(p_source text, p_kind text, p_message text, p_tier text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_status integer DEFAULT NULL::integer, p_company_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid)
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
    (company_id, conversation_id, source, kind, tier, model, status, message, reported_by)
  values
    (v_company_id, v_conversation_id, p_source, p_kind, p_tier,
     case when p_model ~ '^[a-z0-9.-]{1,64}$' then p_model end, p_status,
     left(coalesce(nullif(trim(p_message), ''), 'no message'), 2000), (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;


-- 10 --------------------------------------------------------------------------

-- Unreachable (the private schema is not exposed), and now not executable
-- either.
revoke all on function private.may_edit_conversation(uuid, uuid) from public, anon;
revoke all on function private.plan_limit(text, text) from public, anon;
