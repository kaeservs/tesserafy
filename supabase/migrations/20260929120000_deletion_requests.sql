-- "Delete my account": a person asks, leaves their company at once, and an
-- operator deletes the login (ADR 0013).
--
-- The customer app cannot delete an account — that needs the service-role
-- key, which it never holds (invariant 3). So the person asks, and the ask is
-- a row an operator acts on, like a teammate request.
--
-- Asking takes them out of their company straight away. Someone asking to be
-- forgotten wants out now, not when an operator gets to it, and an account in
-- no company is exactly what the operator's deletion accepts: its rules stay
-- as they are. The leaving is recorded in membership_removals like any
-- removal, with removed_by the person themselves, so the company's owner sees
-- who left and when.
--
-- An owner cannot ask while their company exists: a company needs an owner,
-- and there is no handing ownership over in the product yet. The page says
-- what to do instead. An operator's account is removed by another operator.
--
-- When the operator's deletion completes, it resolves the request, so the
-- queue empties itself and nothing has to be closed by hand.

create table public.account_deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  -- No foreign key: the request outlives the account it asks to delete.
  user_id      uuid not null,
  -- The company they left by asking, if any. Kept for the operator's context.
  company_id   uuid references public.companies (id) on delete set null,
  requested_at timestamptz not null default now(),
  resolved_at  timestamptz,
  deletion_id  uuid references public.account_deletions (id)
);

-- One open request per person; asking again returns it.
create unique index account_deletion_requests_one_open
  on public.account_deletion_requests (user_id) where resolved_at is null;

comment on table public.account_deletion_requests is
  'A person asking for their own account to be deleted. Resolved when an operator deletes it (ADR 0013).';

alter table public.account_deletion_requests enable row level security;

create policy "a person reads their own request"
  on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));

create policy "admins read all deletion requests"
  on public.account_deletion_requests for select to authenticated
  using ((select private.is_platform_admin()));


create function public.request_account_deletion(p_confirm_email text)
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

  -- Asked before: the same request, not a second one.
  select * into v_row from public.account_deletion_requests r
   where r.user_id = v_uid and r.resolved_at is null;
  if v_row.id is not null then
    return v_row;
  end if;

  select m.company_id, m.role into v_company, v_role
    from public.company_members m where m.user_id = v_uid limit 1;

  if v_role = 'owner' then
    raise exception 'request_account_deletion: an owner cannot leave their company this way; ask Tesserafy to close the company, or to make someone else its owner'
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

revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;


-- The operator's deletion, as before, and now it also resolves any request
-- for that account.
create or replace function public.complete_account_deletion(p_id uuid)
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.account_deletions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'complete_account_deletion: not a platform admin' using errcode = '42501';
  end if;

  select * into v_row from public.account_deletions d
   where d.id = p_id and d.admin_user_id = (select auth.uid()) and d.completed_at is null;
  if v_row.id is null then
    raise exception 'complete_account_deletion: no unfinished deletion of yours with that id'
      using errcode = '42501';
  end if;

  -- Closed only on the evidence: the account is actually gone.
  if exists (select 1 from auth.users u where u.id = v_row.user_id) then
    raise exception 'complete_account_deletion: the account still exists' using errcode = '22023';
  end if;

  update public.account_deletions set completed_at = now() where id = p_id
  returning * into v_row;

  update public.account_deletion_requests
     set resolved_at = now(), deletion_id = p_id
   where user_id = v_row.user_id and resolved_at is null;

  return v_row;
end;
$$;
