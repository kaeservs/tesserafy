-- Customer accounts: which customer a call was with.
--
-- Until now three calls with Acme Robotics were three unrelated rows. A sales
-- team thinks in accounts — what did Acme say last time, where does the deal
-- stand, what have they asked for across every call — and the product could
-- not answer, because nothing said a call was with Acme. An account is that:
-- a customer company's name (and, optionally, its web domain), owned by the
-- brand, that calls point at.
--
-- Any member can name an account, from an import or a call — sellers are the
-- ones who know who a call was with. save_account finds one by name before
-- creating it, so "Acme Robotics" typed twice is one account. Renaming is for
-- an owner or whoever created it; deleting is an owner's, and unlinks the
-- calls rather than touching them (the foreign key sets only account_id to
-- null, which Postgres 15+ can say).
--
-- A call's account is set through edit_conversation like every other
-- correction, by the same people, and logged the same way.
--
-- Account names are customers' company names: business data, but the
-- customer's all the same. Closing a company removes them, as it removes the
-- company's tracker.

create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120 and name = trim(name)),
  domain      text check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, id)
);

create unique index accounts_name_idx on public.accounts (company_id, lower(name));

comment on table public.accounts is
  'The customer companies a brand''s calls are with. Members read and name them; owners delete them.';

alter table public.accounts enable row level security;

create policy "members read their company's accounts"
  on public.accounts for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all accounts"
  on public.accounts for select to authenticated
  using ((select private.is_platform_admin()));

alter table public.conversations
  add column account_id uuid,
  add constraint conversations_account_fk
    foreign key (company_id, account_id) references public.accounts (company_id, id)
    on delete set null (account_id);

create index conversations_account_idx on public.conversations (company_id, account_id)
  where account_id is not null;

alter table public.conversation_edits drop constraint conversation_edits_field_check;
alter table public.conversation_edits add constraint conversation_edits_field_check
  check (field in ('title', 'occurred_at', 'scorecard', 'outcome', 'account'));


-- The account called this, in the caller's company: found if it exists
-- (ignoring case), created if not. Any member. Returns its id.
create function public.save_account(p_name text, p_domain text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_name       text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_domain     text := nullif(lower(trim(coalesce(p_domain, ''))), '');
  v_id         uuid;
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'save_account: not a member of a company' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'save_account: an account''s name is 1 to 120 characters' using errcode = '22023';
  end if;

  select a.id into v_id from public.accounts a
   where a.company_id = v_company_id and lower(a.name) = lower(v_name);
  if v_id is not null then
    return v_id;
  end if;

  insert into public.accounts (company_id, name, domain, created_by)
  values (v_company_id, v_name, v_domain, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Rename it, or set its domain: an owner, or whoever created it.
create function public.rename_account(p_account_id uuid, p_name text, p_domain text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.accounts;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  select * into v_row from public.accounts a where a.id = p_account_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'rename_account: account not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_row.company_id and m.user_id = (select auth.uid())
       and (m.role = 'owner' or v_row.created_by = (select auth.uid()))
  ) then
    raise exception 'rename_account: only an owner, or whoever added the account, can rename it' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'rename_account: an account''s name is 1 to 120 characters' using errcode = '22023';
  end if;
  update public.accounts
     set name = v_name, domain = nullif(lower(trim(coalesce(p_domain, ''))), '')
   where id = p_account_id;
exception
  when unique_violation then
    raise exception 'rename_account: another account already has that name' using errcode = '23505';
end;
$$;

-- Delete it, as an owner. Its calls stay, unlinked.
create function public.delete_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
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

revoke all on function public.save_account(text, text) from public, anon;
revoke all on function public.rename_account(uuid, text, text) from public, anon;
revoke all on function public.delete_account(uuid) from public, anon;
grant execute on function public.save_account(text, text) to authenticated;
grant execute on function public.rename_account(uuid, text, text) to authenticated;
grant execute on function public.delete_account(uuid) to authenticated;


-- A closed company keeps no list of its customers.
create function private.forget_accounts_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.accounts where company_id = new.id;
  end if;
  return new;
end;
$$;

create trigger companies_forget_accounts_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_accounts_on_close();


-- A call's account is set like any other correction. The signature grows, so
-- the old one is dropped rather than left beside it as an overload.
drop function public.edit_conversation(uuid, text, timestamptz, boolean, text, integer, text);

create function public.edit_conversation(
  p_conversation_id  uuid,
  p_title            text    default null,
  p_occurred_at      timestamptz default null,
  p_clear_date       boolean default false,
  p_engagement_type  text    default null,
  p_criteria_version integer default null,
  p_outcome          text    default null,
  p_account_id       uuid    default null,
  p_clear_account    boolean default false
)
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

revoke all on function public.edit_conversation(uuid, text, timestamptz, boolean, text, integer, text, uuid, boolean) from public, anon;
grant execute on function public.edit_conversation(uuid, text, timestamptz, boolean, text, integer, text, uuid, boolean) to authenticated;
