-- Handing over ownership: who is an owner of a company can change.
--
-- Until now a role was fixed when the person was added. Nothing in the product
-- could make a member an owner or an owner a member, so the only owner of a
-- company could never step down — not to leave, not to delete their account
-- (which an owner may not ask for while their company exists), not because
-- they moved on. The page promised "ask Tesserafy to make someone else its
-- owner", and Tesserafy had no way to except SQL.
--
-- One rule, enforced in one place (private.set_member_role): a company always
-- keeps at least one owner. Within that, an owner changes anyone's role in
-- their own company, their own included; an operator changes anyone's in any
-- company — the case where the only owner has left the business and cannot
-- be asked.
--
-- Every change is recorded before it happens, with the address as it was
-- then, the same way removals are: owners of the company and operators read
-- it. "Someone became an owner" is not a record.

create table public.membership_role_changes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null,
  from_role   text not null check (from_role in ('owner', 'member')),
  to_role     text not null check (to_role in ('owner', 'member')),
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index membership_role_changes_company_idx on public.membership_role_changes (company_id, changed_at desc);

comment on table public.membership_role_changes is
  'One row per change of someone''s role in a company. Written before the change. Append-only.';

alter table public.membership_role_changes enable row level security;

create policy "owners read their company's role changes"
  on public.membership_role_changes for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = membership_role_changes.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all role changes"
  on public.membership_role_changes for select to authenticated
  using ((select private.is_platform_admin()));


-- The rule, once. Callers decide who may; this decides what may happen.
create function private.set_member_role(
  p_company_id uuid,
  p_user_id    uuid,
  p_role       text,
  p_actor      uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_email text;
begin
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'a role is owner or member' using errcode = '22023';
  end if;

  select m.role, u.email::text into v_role, v_email
    from public.company_members m
    join auth.users u on u.id = m.user_id
   where m.company_id = p_company_id and m.user_id = p_user_id
     for update of m;

  if v_role is null then
    raise exception 'not in that company' using errcode = '22023';
  end if;
  if v_role = p_role then
    raise exception 'they are already % of it', (case p_role when 'owner' then 'an owner' else 'a member' end)
      using errcode = '22023';
  end if;

  -- Stepping down leaves someone else holding it. The company's owner rows are
  -- locked first, so two owners stepping down at once cannot both see the
  -- other still there and both pass.
  if v_role = 'owner' then
    perform 1 from public.company_members m
     where m.company_id = p_company_id and m.role = 'owner'
       for update;
    if not exists (
      select 1 from public.company_members m
       where m.company_id = p_company_id and m.role = 'owner' and m.user_id <> p_user_id
    ) then
      raise exception 'a company needs an owner: make someone else one first' using errcode = '22023';
    end if;
  end if;

  insert into public.membership_role_changes (company_id, user_id, email, from_role, to_role, changed_by)
  values (p_company_id, p_user_id, v_email, v_role, p_role, p_actor);

  update public.company_members set role = p_role
   where company_id = p_company_id and user_id = p_user_id;
end;
$$;

revoke all on function private.set_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;


-- An owner, in their own company. The company comes from the session.
create function public.set_member_role(p_user_id uuid, p_role text)
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
  ) then
    raise exception 'set_member_role: only an owner can change someone''s role' using errcode = '42501';
  end if;

  perform private.set_member_role(v_company_id, p_user_id, p_role, (select auth.uid()));
exception
  when sqlstate '22023' then
    raise exception 'set_member_role: %', sqlerrm using errcode = '22023';
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;


-- An operator, in any company.
create function public.admin_set_member_role(p_company_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_member_role: not a platform admin' using errcode = '42501';
  end if;

  perform private.set_member_role(p_company_id, p_user_id, p_role, (select auth.uid()));
exception
  when sqlstate '22023' then
    raise exception 'admin_set_member_role: %', sqlerrm using errcode = '22023';
end;
$$;

revoke all on function public.admin_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.admin_set_member_role(uuid, uuid, text) to authenticated;


-- "Delete my account", as before, with an owner now told what they can do
-- themselves: hand over, step down, then ask.
create or replace function public.request_account_deletion(p_confirm_email text)
returns public.account_deletion_requests
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
