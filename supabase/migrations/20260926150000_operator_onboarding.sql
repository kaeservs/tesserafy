-- Operator onboarding: a company, its first owner, and the people after them.
--
-- Until checkout exists, the only way a pilot customer got an account was
-- hand-written SQL against production. This gives the operator console a way
-- to do it, in the same shape as support sessions (20260923181208): the
-- decision and the record happen here, as the operator, before anything is
-- created; the service-role key is used only for the one Auth admin call no
-- signed-in user can make — creating the account and a link to sign in — and
-- never writes a table. ADR 0012 records the key's second use.
--
-- Two calls, because the account is created between them:
--   open_account_provisioning      as the operator: allowed? write it down.
--   (the console, with the key)    create the account or find it; make a link.
--   complete_account_provisioning  as the operator: the account is the one
--                                  recorded; create the company if new; add
--                                  the membership; close the record.
-- An attempt that fails between the two stays open in the log, which is what
-- happened, rather than vanishing.
--
-- One company per person. Much of the product resolves "the caller's company"
-- and refuses to guess between two, so someone who already belongs to one is
-- refused here rather than half-broken later. Staff reach a customer's account
-- through a support session, not a membership.
--
-- A later checkout webhook can create companies the same way; the checks here
-- do not depend on who is calling beyond "a platform admin".

create table public.account_provisioning (
  id              uuid primary key default gen_random_uuid(),
  admin_user_id   uuid not null references auth.users (id),
  -- Lower-cased and trimmed on the way in, so the check against the account
  -- that is created is an equality, not a guess.
  email           text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role            text not null check (role in ('owner', 'member')),
  -- Exactly one: a company that exists, or the name of one to create.
  company_id      uuid references public.companies (id),
  company_name    text check (company_name is null or length(trim(company_name)) > 0),
  plan            text check (plan is null or plan in ('trial', 'pilot', 'paid', 'internal')),
  created_at      timestamptz not null default now(),
  -- Filled on completion.
  user_id         uuid references auth.users (id) on delete set null,
  new_account     boolean,
  completed_at    timestamptz,
  check ((company_id is null) <> (company_name is null) or completed_at is not null)
);

create index account_provisioning_created_idx on public.account_provisioning (created_at desc);

comment on table public.account_provisioning is
  'One row per account or membership an operator created. Written before the account exists; completed after. Append-only.';

alter table public.account_provisioning enable row level security;

create policy "admins read provisioning"
  on public.account_provisioning for select to authenticated
  using ((select private.is_platform_admin()));


create function public.open_account_provisioning(
  p_email        text,
  p_role         text,
  p_company_id   uuid default null,
  p_company_name text default null,
  p_plan         text default 'pilot'
)
returns public.account_provisioning
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
  if v_name is not null and (p_plan is null or p_plan not in ('trial', 'pilot', 'paid', 'internal')) then
    raise exception 'open_account_provisioning: plan is trial, pilot, paid or internal' using errcode = '22023';
  end if;
  if p_company_id is not null
     and not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'open_account_provisioning: no such company' using errcode = '22023';
  end if;

  -- The account may not exist yet; when it does, it must not already be in a
  -- company. complete_ checks again, against the account actually returned.
  select u.id into v_existing from auth.users u where lower(u.email) = v_email;
  if v_existing is not null
     and exists (select 1 from public.company_members m where m.user_id = v_existing) then
    raise exception 'open_account_provisioning: % already belongs to a company', v_email
      using errcode = '22023';
  end if;

  insert into public.account_provisioning (admin_user_id, email, role, company_id, company_name, plan)
  values ((select auth.uid()), v_email, p_role, p_company_id, v_name,
          case when v_name is not null then p_plan end)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.open_account_provisioning(text, text, uuid, text, text) from public, anon;
grant execute on function public.open_account_provisioning(text, text, uuid, text, text) to authenticated;


create function public.complete_account_provisioning(
  p_id          uuid,
  p_user_id     uuid,
  p_new_account boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.account_provisioning;
  v_company uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'complete_account_provisioning: not a platform admin' using errcode = '42501';
  end if;

  select * into v_row from public.account_provisioning where id = p_id for update;
  if v_row.id is null or v_row.completed_at is not null then
    raise exception 'complete_account_provisioning: no open record %', p_id using errcode = '22023';
  end if;
  -- Whoever opened it closes it: the record names one operator for the whole act.
  if v_row.admin_user_id <> (select auth.uid()) then
    raise exception 'complete_account_provisioning: opened by another operator' using errcode = '42501';
  end if;

  -- The account the key came back with must be the one that was recorded.
  -- An id is all the console passes; the email is checked here.
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_row.email) then
    raise exception 'complete_account_provisioning: that account is not %', v_row.email
      using errcode = '22023';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = p_user_id) then
    raise exception 'complete_account_provisioning: % already belongs to a company', v_row.email
      using errcode = '22023';
  end if;

  if v_row.company_name is not null then
    insert into public.companies (name, plan)
    values (v_row.company_name, v_row.plan)
    returning id into v_company;
  else
    v_company := v_row.company_id;
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (v_company, p_user_id, v_row.role);

  update public.account_provisioning
     set user_id = p_user_id,
         company_id = v_company,
         new_account = p_new_account,
         completed_at = now()
   where id = p_id;

  return v_company;
end;
$$;

revoke all on function public.complete_account_provisioning(uuid, uuid, boolean) from public, anon;
grant execute on function public.complete_account_provisioning(uuid, uuid, boolean) to authenticated;
