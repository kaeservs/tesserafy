-- Self-serve sign-up: a brand creates its own company, behind a switch.
--
-- Until now every company was created by an operator (ADR 0012). The owner
-- wants brands to sign up themselves — an account, a confirmed address, a
-- company on the fourteen-day trial — but not until email works: without a
-- provider, Supabase's own mailer sends two confirmation emails an hour. So
-- the whole path is built and switched off.
--
-- The switch is here, not in the web app. Supabase Auth already lets anyone
-- create an account (it always has; they got an empty /welcome page). The
-- thing worth gating is the step that gives an account a company and a free
-- trial, and a gate that lived only in the web app's pages would leave
-- create_my_company callable straight through PostgREST while "closed".
-- The page reads the same switch, so what it says and what the database
-- does cannot disagree. The operator flips it in the console, recorded.
--
-- Against trial farming: the address must be confirmed, and an account
-- creates one company, ever — leaving one, being removed, or having it
-- closed does not buy another trial.

create table public.app_settings (
  -- One row, always: the check makes a second one impossible.
  id           boolean primary key default true check (id),
  signup_open  boolean not null default false,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;

create policy "admins read settings"
  on public.app_settings for select to authenticated
  using ((select private.is_platform_admin()));


-- Public: the sign-up page asks before anyone has signed in.
create function public.signup_is_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select signup_open from public.app_settings where id;
$$;

revoke all on function public.signup_is_open() from public;
grant execute on function public.signup_is_open() to anon, authenticated;


create function public.admin_set_signup_open(p_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_signup_open: not a platform admin' using errcode = '42501';
  end if;
  if p_open is null then
    raise exception 'admin_set_signup_open: open or closed' using errcode = '22023';
  end if;
  update public.app_settings
     set signup_open = p_open, updated_by = (select auth.uid()), updated_at = now()
   where id;
end;
$$;

revoke all on function public.admin_set_signup_open(boolean) from public, anon;
grant execute on function public.admin_set_signup_open(boolean) to authenticated;


-- Who created a company, when a person did (null for operator-created ones,
-- which account_provisioning already records).
alter table public.companies
  add column created_by uuid references auth.users (id) on delete set null;

create unique index companies_one_per_creator on public.companies (created_by) where created_by is not null;


create function public.create_my_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text := trim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'create_my_company: sign in first' using errcode = '42501';
  end if;
  if not (select public.signup_is_open()) then
    raise exception 'create_my_company: sign-up is not open yet' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'create_my_company: confirm your email address first' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_uid) then
    raise exception 'create_my_company: you already belong to a company' using errcode = '22023';
  end if;
  if exists (select 1 from public.companies c where c.created_by = v_uid) then
    raise exception 'create_my_company: this account has already created a company' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'create_my_company: a company name is 2 to 100 characters' using errcode = '22023';
  end if;

  -- The trial starts by itself: companies_start_subscription (20260928090000).
  insert into public.companies (name, plan, created_by)
  values (v_name, 'trial', v_uid)
  returning id into v_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

revoke all on function public.create_my_company(text) from public, anon;
grant execute on function public.create_my_company(text) to authenticated;
