-- A company's CRM, connected by its owner, and each call logged to it as a
-- note on the customer's record (ADR 0024). HubSpot first; `provider` is a
-- column, so Salesforce or Pipedrive is a new value and a new client.
--
-- The same shape as a company's tracker (ADR 0015): the owner pastes a token
-- from their own HubSpot (a private app's access token), the web server checks
-- it with HubSpot, seals it with a key only it holds (CRM_TOKEN_KEY, the
-- company's id bound in), and only the sealed form is stored. Customers can
-- select every column but the ciphertext; the one path to it is
-- `crm_for_call`, for a call in the caller's own company. Closing a company
-- forgets its CRM.
--
-- What was logged is kept per call: the note's id in the CRM, so logging again
-- updates the same note rather than adding another, and which record it was
-- put on. It goes with the call.
--
-- A support session does not write to a customer's CRM: an operator who
-- opened an account to look into something does not put notes in that
-- company's systems.

create table public.company_crms (
  company_id       uuid primary key references public.companies (id) on delete cascade,
  provider         text not null check (provider in ('hubspot')),
  -- For HubSpot, the account's id (its "portal" or "hub" id).
  account_ref      text not null check (account_ref ~ '^[0-9]{1,20}$'),
  token_ciphertext text not null check (token_ciphertext like 'v1:%' and length(token_ciphertext) <= 8000),
  -- The last four characters, so an owner can tell which token this is.
  token_hint       text not null check (length(token_hint) between 1 and 8),
  connected_by     uuid references auth.users (id) on delete set null,
  connected_at     timestamptz not null default now(),
  -- What the CRM said when it last refused, until the next success.
  last_error       text check (last_error is null or length(last_error) <= 300)
);

comment on table public.company_crms is
  'Each company''s own CRM, where its calls are logged. The token is encrypted by the web server (ADR 0024).';

alter table public.company_crms enable row level security;

create policy "members read their company's CRM"
  on public.company_crms for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all CRMs"
  on public.company_crms for select to authenticated
  using ((select private.is_platform_admin()));

-- Column by column, so the ciphertext is not one of them.
revoke select on public.company_crms from authenticated, anon;
grant select (company_id, provider, account_ref, token_hint, connected_by, connected_at, last_error)
  on public.company_crms to authenticated;


-- Who connected or disconnected which CRM, and when. Owners and operators
-- read it; the token never appears in it.
create table public.crm_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  action      text not null check (action in ('connected', 'disconnected')),
  provider    text not null,
  account_ref text not null,
  actor       uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now()
);

create index crm_events_company_idx on public.crm_events (company_id, at desc);

alter table public.crm_events enable row level security;

create policy "owners read their company's CRM events"
  on public.crm_events for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = crm_events.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all CRM events"
  on public.crm_events for select to authenticated
  using ((select private.is_platform_admin()));


-- Each call's note in the CRM: one a call a CRM, updated when logged again.
create table public.crm_logs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  provider         text not null check (provider in ('hubspot')),
  external_id      text not null check (external_id ~ '^[0-9]{1,30}$'),
  -- The customer's record the note was put on, and how many of its people.
  crm_company_id   text check (crm_company_id is null or crm_company_id ~ '^[0-9]{1,30}$'),
  crm_company_name text check (crm_company_name is null or length(crm_company_name) <= 300),
  contacts         integer not null default 0 check (contacts between 0 and 50),
  logged_by        uuid references auth.users (id) on delete set null,
  logged_at        timestamptz not null default now(),
  unique (conversation_id, provider),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

comment on table public.crm_logs is
  'Each call''s note in the company''s CRM: its id there, the record it is on, who logged it and when.';

alter table public.crm_logs enable row level security;

create policy "members read their company's CRM logs"
  on public.crm_logs for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Whether the caller's session began inside a support window, open or not:
-- the session an operator's sign-in link started. (The same definition as
-- the follow-up sending's; whichever migration runs second replaces it with
-- itself.)
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
       and s.created_at <= a.expires_at
  );
$$;

revoke all on function private.in_support_session() from public, anon;


create function public.connect_crm(
  p_provider         text,
  p_account_ref      text,
  p_token_ciphertext text,
  p_token_hint       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'connect_crm: only an owner can connect a CRM' using errcode = '42501';
  end if;

  insert into public.crm_events (company_id, action, provider, account_ref, actor)
  values (v_company_id, 'connected', p_provider, p_account_ref, (select auth.uid()));

  insert into public.company_crms (company_id, provider, account_ref, token_ciphertext, token_hint, connected_by)
  values (v_company_id, p_provider, p_account_ref, p_token_ciphertext, p_token_hint, (select auth.uid()))
  on conflict (company_id) do update
     set provider = excluded.provider,
         account_ref = excluded.account_ref,
         token_ciphertext = excluded.token_ciphertext,
         token_hint = excluded.token_hint,
         connected_by = excluded.connected_by,
         connected_at = now(),
         last_error = null;
end;
$$;

create function public.disconnect_crm()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_row public.company_crms;
begin
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

-- A closed company keeps no key to anyone's CRM (closing keeps the company row,
-- so the cascade never fires).
create function private.forget_crm_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_crms;
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.company_crms where company_id = new.id returning * into v_row;
    if v_row.company_id is not null then
      insert into public.crm_events (company_id, action, provider, account_ref, actor)
      values (new.id, 'disconnected', v_row.provider, v_row.account_ref, (select auth.uid()));
    end if;
  end if;
  return new;
end;
$$;

create trigger companies_forget_crm_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_crm_on_close();


-- The one way to the ciphertext: for a call in the caller's own company, not
-- from a support session. What comes back is still encrypted; only the web
-- server can use it. Empty when no CRM is connected.
create function public.crm_for_call(p_conversation_id uuid)
returns table (provider text, account_ref text, token_ciphertext text, company_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'crm_for_call: call not found' using errcode = 'P0002';
  end if;
  if (select private.in_support_session()) then
    raise exception 'crm_for_call: a support session does not write to the customer''s CRM' using errcode = '42501';
  end if;

  return query
    select t.provider, t.account_ref, t.token_ciphertext, t.company_id
      from public.company_crms t where t.company_id = v_company_id;
end;
$$;

-- A call's note was written (or rewritten) in the CRM.
create function public.record_crm_log(
  p_conversation_id  uuid,
  p_provider         text,
  p_external_id      text,
  p_crm_company_id   text default null,
  p_crm_company_name text default null,
  p_contacts         integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'record_crm_log: call not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.company_crms t where t.company_id = v_company_id and t.provider = p_provider) then
    raise exception 'record_crm_log: that CRM is not connected' using errcode = '22023';
  end if;

  insert into public.crm_logs
    (company_id, conversation_id, provider, external_id, crm_company_id, crm_company_name, contacts, logged_by)
  values
    (v_company_id, p_conversation_id, p_provider, p_external_id, p_crm_company_id, left(p_crm_company_name, 300),
     least(greatest(coalesce(p_contacts, 0), 0), 50), (select auth.uid()))
  on conflict (conversation_id, provider) do update
     set external_id = excluded.external_id,
         crm_company_id = excluded.crm_company_id,
         crm_company_name = excluded.crm_company_name,
         contacts = excluded.contacts,
         logged_by = excluded.logged_by,
         logged_at = now();

  update public.company_crms set last_error = null where company_id = v_company_id;
end;
$$;

-- The CRM refused: said on the connection, for the owner to see on Settings.
create function public.record_crm_error(p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_crm_error: not a member of a company' using errcode = '42501';
  end if;
  update public.company_crms set last_error = left(p_error, 300) where company_id = v_company_id;
end;
$$;

revoke all on function public.connect_crm(text, text, text, text) from public, anon;
revoke all on function public.disconnect_crm() from public, anon;
revoke all on function public.crm_for_call(uuid) from public, anon;
revoke all on function public.record_crm_log(uuid, text, text, text, text, integer) from public, anon;
revoke all on function public.record_crm_error(text) from public, anon;
grant execute on function public.connect_crm(text, text, text, text) to authenticated;
grant execute on function public.disconnect_crm() to authenticated;
grant execute on function public.crm_for_call(uuid) to authenticated;
grant execute on function public.record_crm_log(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.record_crm_error(text) to authenticated;
