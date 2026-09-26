-- Deleting an account: the operator console's third Auth admin call (ADR 0013).
--
-- Same shape as onboarding (20260926150000): the decision and the record
-- happen here, as the operator, before anything is deleted; the service-role
-- key makes the one Auth admin call no signed-in user can make for somebody
-- else — deleting their account — and touches no table.
--
--   open_account_deletion      as the operator: allowed? write it down.
--   (the console, with the key) delete the account in Auth.
--   complete_account_deletion  as the operator: the account is gone; close it.
--
-- Only an account in no company, that is not an operator's, and that nobody
-- is signed in as through a support session. Somebody in a company leaves it
-- first — the owner removes them, or the company is closed — so deleting an
-- account never reaches into a live company's team.
--
-- What is kept, and why that is not a contradiction.
--
-- The records that say what a person did or had done to them stay: the
-- support-access log in particular is "never erased", because it is the
-- record a customer may one day need against us. They keep the account's id.
-- They lose the foreign key, because a foreign key to an account is exactly
-- what stops Auth deleting it. The id is not the person: once the account is
-- gone it resolves to nothing, and no email, name or password goes with it.
--
-- The deletion record keeps a SHA-256 of the address rather than the address,
-- so "was this address erased, and when?" can be answered by someone who
-- already knows it, and not by anyone reading the table.
--
-- Every other reference to an account already cascades (memberships, operator
-- rows) or is set to null (who added a call, who confirmed consent, and the
-- like). The test beside this checks that nothing outside Auth can block a
-- deletion, so a later table that forgets fails CI rather than a deletion.


-- ---------------------------------------------------------------------------
-- References that outlive the account
-- ---------------------------------------------------------------------------

alter table public.support_access
  drop constraint support_access_admin_user_id_fkey,
  drop constraint support_access_subject_user_id_fkey;

comment on column public.support_access.admin_user_id is
  'The operator. No foreign key: the record outlives the account (ADR 0013).';
comment on column public.support_access.subject_user_id is
  'Whose account was opened. No foreign key: the record outlives the account (ADR 0013).';

alter table public.account_provisioning
  drop constraint account_provisioning_admin_user_id_fkey;

alter table public.insights
  drop constraint insights_decided_by_fkey;

alter table public.insight_tickets
  drop constraint insight_tickets_created_by_fkey;


-- The foreign key was also what refused a support session for an account that
-- does not exist. Every other writer of these columns takes the id from the
-- session, which exists by construction; this one takes it from the operator,
-- so it now checks for itself.
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
-- The record of deleting
-- ---------------------------------------------------------------------------

create table public.account_deletions (
  id            uuid primary key default gen_random_uuid(),
  -- Neither id has a foreign key: one of them is the account being deleted.
  admin_user_id uuid not null,
  user_id       uuid not null,
  email_sha256  text not null check (email_sha256 ~ '^[0-9a-f]{64}$'),
  -- Free text, as for support sessions. It is shown to operators only; the
  -- console asks for a reason that does not repeat the address.
  reason        text not null check (length(trim(reason)) > 0),
  created_at    timestamptz not null default now(),
  -- Set once Auth has deleted the account. Null afterwards means the attempt
  -- did not finish, and the console says so.
  completed_at  timestamptz
);

create index account_deletions_user_idx on public.account_deletions (user_id);
create index account_deletions_created_idx on public.account_deletions (created_at desc);

comment on table public.account_deletions is
  'One row per account an operator deleted. Written before the deletion; completed after. Append-only.';

alter table public.account_deletions enable row level security;

create policy "admins read deletions"
  on public.account_deletions for select to authenticated
  using ((select private.is_platform_admin()));


create function public.open_account_deletion(p_user_id uuid, p_reason text)
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_email text;
  v_company text;
  v_row public.account_deletions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'open_account_deletion: not a platform admin' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'open_account_deletion: a reason is required' using errcode = '22023';
  end if;

  if p_user_id = v_admin then
    raise exception 'open_account_deletion: that is you' using errcode = '22023';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'open_account_deletion: no such account' using errcode = '22023';
  end if;

  if exists (select 1 from public.platform_admins a where a.user_id = p_user_id) then
    raise exception 'open_account_deletion: that account is an operator''s' using errcode = '22023';
  end if;

  select c.name into v_company
    from public.company_members m join public.companies c on c.id = m.company_id
   where m.user_id = p_user_id
   limit 1;
  if v_company is not null then
    raise exception 'open_account_deletion: they belong to %; they must leave it first, or it must be closed', v_company
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.support_access sa
     where sa.subject_user_id = p_user_id and sa.ended_at is null and sa.expires_at > now()
  ) then
    raise exception 'open_account_deletion: a support session is open on that account; end it first'
      using errcode = '22023';
  end if;

  insert into public.account_deletions (admin_user_id, user_id, email_sha256, reason)
  values (
    v_admin,
    p_user_id,
    encode(sha256(convert_to(lower(coalesce(v_email, '')), 'UTF8')), 'hex'),
    trim(p_reason)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.open_account_deletion(uuid, text) from public, anon;
grant execute on function public.open_account_deletion(uuid, text) to authenticated;


create function public.complete_account_deletion(p_id uuid)
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
  return v_row;
end;
$$;

revoke all on function public.complete_account_deletion(uuid) from public, anon;
grant execute on function public.complete_account_deletion(uuid) to authenticated;
