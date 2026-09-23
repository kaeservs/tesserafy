-- Who runs the product, and what it costs to look at somebody's account.--
-- Filename carries the version the remote assigned, as with the last three:
-- the pooler `supabase db push` needs is unreliable, so this went in over
-- REST, which numbers its own migrations.
--
-- The first admin is NOT seeded here. A migration that hands a named person
-- cross-tenant access would hardcode one environment's email into every
-- environment, and would fail on a fresh database where that account does not
-- exist. It is an operator statement, run once, deliberately:
--
--   insert into public.platform_admins (user_id, note)
--   select id, '<why this person>' from auth.users where email = '<address>';
--
-- The question this answers is "one of five users has a problem and I need to
-- see what they see". That was already possible — anyone holding the
-- service-role key can mint a session for any email through the Auth admin
-- API, which is what scripts/qa.ts does for the probe account. The problem was
-- never capability. It was that the capability left no trace, expired never,
-- and attributed everything it did to the person being impersonated.
--
-- So this adds the two things that were missing: a named set of people allowed
-- to do it, and a record of every time they do.
--
-- Note what is deliberately NOT here. There is no way to grant yourself
-- platform admin, and no RPC that adds a row to platform_admins: the only way
-- in is the service role, which means a migration or an operator with the key.
-- A self-service path to cross-tenant access is the whole vulnerability.

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  -- Why this person has it. A list of user ids with no reasons is a list
  -- nobody can review, and an access list nobody reviews only grows.
  note        text not null check (length(trim(note)) > 0),
  created_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'People who may read across tenants and open a support session. Service-role writes only.';

alter table public.platform_admins enable row level security;

-- Admins can see the list they are on. Nobody else learns it exists.
create policy "admins read the admin list"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));


create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  );
$$;

-- Granted to authenticated for the same reason is_company_member is: the RLS
-- policies below call it, and a policy is evaluated as the caller.
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- The record of looking
-- ---------------------------------------------------------------------------
-- Written before the session is minted, not after. If the recording fails the
-- access does not happen, which is the only ordering that makes the record
-- worth anything.
--
-- It is never deleted by erasure. A conversation can be erased; the fact that
-- a member of staff opened this customer's account cannot be, because that is
-- the record somebody may one day need against us.

create table public.support_access (
  id           uuid primary key default gen_random_uuid(),
  -- Both sides, always. "Someone opened this account" is not an audit trail.
  admin_user_id   uuid not null references auth.users (id),
  subject_user_id uuid not null references auth.users (id),
  -- Free text on purpose: a ticket number, a sentence, whatever is true. A
  -- dropdown of reasons becomes one reason everybody picks.
  reason       text not null check (length(trim(reason)) > 0),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  -- Set when the admin says they are done. Null means it ran to expiry, which
  -- is not an error, only less tidy.
  ended_at     timestamptz
);

create index support_access_subject_idx on public.support_access (subject_user_id, created_at desc);
create index support_access_admin_idx on public.support_access (admin_user_id, created_at desc);

comment on table public.support_access is
  'One row per support session opened against a user. Append-only; never erased.';

alter table public.support_access enable row level security;

-- A user can see when their own account was opened, and by whom. That is the
-- point: an audit trail the audited cannot read is a private diary.
create policy "a user reads access to their own account"
  on public.support_access for select to authenticated
  using (subject_user_id = (select auth.uid()));

create policy "admins read all support access"
  on public.support_access for select to authenticated
  using ((select private.is_platform_admin()));


-- ---------------------------------------------------------------------------
-- Opening a session
-- ---------------------------------------------------------------------------
-- This does not mint anything. Minting a session needs the Auth admin API and
-- therefore the service-role key, which stays with the operator tooling. What
-- this does is decide whether the access is allowed and write it down, so that
-- the tool that mints has to come through here first.

create function public.open_support_access(
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

revoke all on function public.open_support_access(uuid, text, integer) from public, anon;
grant execute on function public.open_support_access(uuid, text, integer) to authenticated, service_role;


create function public.end_support_access(p_id uuid)
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

  return v_row;
end;
$$;

revoke all on function public.end_support_access(uuid) from public, anon;
grant execute on function public.end_support_access(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- What an admin sees
-- ---------------------------------------------------------------------------
-- A plan column, and an honest comment about what it is. There is no billing
-- in this product: no prices, no subscriptions, no invoices. A label that
-- says 'trial' is a label, and pretending otherwise on a dashboard is how a
-- number nobody computed ends up in a board deck.

alter table public.companies
  add column plan text not null default 'trial'
  check (plan in ('trial', 'pilot', 'paid', 'internal'));

comment on column public.companies.plan is
  'A label an operator sets by hand. There is no billing system behind it.';


-- One row per company, with the things support actually needs: how much is in
-- there, when it was last touched, and what has been going wrong lately.
create function public.admin_companies()
returns table (
  company_id      uuid,
  name            text,
  plan            text,
  retention_days  integer,
  members         bigint,
  conversations   bigint,
  segments        bigint,
  last_activity   timestamptz,
  failures_24h    bigint,
  spend_30d_usd   numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_companies: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.retention_days,
    (select count(*) from public.company_members m where m.company_id = c.id),
    (select count(*) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.segments s where s.company_id = c.id),
    (select max(v.created_at) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.system_failures f
      where f.company_id = c.id and f.created_at > now() - interval '24 hours'),
    -- Tokens, not dollars, would be the honest unit; dollars are what gets
    -- asked for. The rates live in scripts/costs.ts and are the published
    -- ones, so this is an estimate and the column name says usd, not billed.
    coalesce((
      select round(sum(
        (u.input_tokens + u.cache_creation_tokens * 1.25 + u.cache_read_tokens * 0.1) / 1e6
          * case u.model when 'claude-opus-5' then 5 when 'claude-sonnet-5' then 2 else 1 end
        + u.output_tokens / 1e6
          * case u.model when 'claude-opus-5' then 25 when 'claude-sonnet-5' then 10 else 5 end
      )::numeric, 4)
      from public.model_usage u
      where u.company_id = c.id and u.created_at > now() - interval '30 days'
    ), 0)
  from public.companies c
  order by c.name;
end;
$$;

revoke all on function public.admin_companies() from public, anon;
grant execute on function public.admin_companies() to authenticated, service_role;


-- The people. Email lives in auth.users, which nothing else in this codebase
-- reads; a support tool that cannot show you an email address is a support
-- tool you will work around.
create function public.admin_users()
returns table (
  user_id        uuid,
  email          text,
  company_id     uuid,
  company_name   text,
  role           text,
  last_sign_in   timestamptz,
  created_at     timestamptz,
  is_admin       boolean,
  open_support   boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_users: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    m.company_id,
    c.name,
    m.role,
    u.last_sign_in_at,
    u.created_at,
    exists (select 1 from public.platform_admins a where a.user_id = u.id),
    exists (
      select 1 from public.support_access sa
      where sa.subject_user_id = u.id and sa.ended_at is null and sa.expires_at > now()
    )
  from auth.users u
  left join public.company_members m on m.user_id = u.id
  left join public.companies c on c.id = m.company_id
  order by u.created_at;
end;
$$;

revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated, service_role;
