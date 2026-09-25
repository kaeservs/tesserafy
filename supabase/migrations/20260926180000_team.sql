-- The team: who has access to a company's calls, and taking it away.
--
-- An owner could not see who was in their company, and nothing in the product
-- could remove anyone. Someone who left a customer's business kept reading
-- every call they had ever been able to, until an operator ran SQL. For a
-- product whose rows are other people's customer conversations, that is the
-- gap that matters most in offboarding, not the one that matters least.
--
-- Everyone in a company can see its team: who can read these calls is a fact
-- about their data every member is entitled to. Only an owner removes, for the
-- same reason only an owner deletes a call. Adding people is not here: it
-- creates an account, which needs the service-role key, which the customer
-- app never holds (invariant 3). The operator console does it (ADR 0012).
--
-- A removal is recorded before the membership goes, with the address as it was
-- then — the account may be deleted later, and "somebody was removed" is not a
-- record. Owners of the company and platform admins can read it; the person
-- removed cannot, because by then they are no longer in the company.

create table public.membership_removals (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null,
  role        text not null check (role in ('owner', 'member')),
  removed_by  uuid references auth.users (id) on delete set null,
  removed_at  timestamptz not null default now()
);

create index membership_removals_company_idx on public.membership_removals (company_id, removed_at desc);

comment on table public.membership_removals is
  'One row per person an owner removed from a company. Written before the membership is deleted. Append-only.';

alter table public.membership_removals enable row level security;

create policy "owners read their company's removals"
  on public.membership_removals for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = membership_removals.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all removals"
  on public.membership_removals for select to authenticated
  using ((select private.is_platform_admin()));


-- Addresses live in auth.users, which no signed-in user can read. This returns
-- the caller's own company's team and nothing else: the company comes from the
-- session, not an argument, so there is no other company to ask about.
create function public.company_team()
returns table (
  user_id          uuid,
  email            text,
  role             text,
  joined_at        timestamptz,
  last_sign_in_at  timestamptz,
  is_you           boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  return query
  select m.user_id, u.email::text, m.role, m.created_at, u.last_sign_in_at,
         m.user_id = (select auth.uid())
    from public.company_members m
    join auth.users u on u.id = m.user_id
   where m.company_id = v_company_id
   order by (m.role = 'owner') desc, u.email;
end;
$$;

revoke all on function public.company_team() from public, anon;
grant execute on function public.company_team() to authenticated;


create function public.remove_company_member(p_user_id uuid)
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

revoke all on function public.remove_company_member(uuid) from public, anon;
grant execute on function public.remove_company_member(uuid) to authenticated;
