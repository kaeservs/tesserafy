-- Two-step sign-in for operators.
--
-- The console can open any customer's account, set any company's plan, close
-- companies and delete accounts, and a password alone stood between that and
-- whoever had one. The check that matters is in the database: every admin
-- function and every "admins read all" policy asks private.is_platform_admin(),
-- and an operator's session can call those through PostgREST without the
-- console at all. So that is where a second factor is required — not in the
-- console's login form, which a stolen password would simply walk around.
--
-- Rolled out with a switch rather than all at once. Required on merge, it
-- would refuse every operator before any had an authenticator, the owner
-- included. So: the console lets operators enrol a TOTP authenticator (and
-- asks for a code at every sign-in once they have one); then an operator,
-- signed in with a code, turns the requirement on. The database refuses to
-- turn it on while any operator has no verified authenticator — nobody is
-- locked out by a colleague — and refuses to change it either way without a
-- code, so a stolen password cannot switch it off first.
--
-- Supabase marks a session that passed the second step as aal2 in its JWT.
-- An operator at aal1, once it is required, is simply not an operator: the
-- admin functions refuse them and the admin policies return nothing, in the
-- console, in the web app and anywhere else their session is used.

alter table public.app_settings
  add column operator_mfa_required boolean not null default false;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  )
  and (
    not coalesce((select s.operator_mfa_required from public.app_settings s where s.id), false)
    or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
  );
$$;


-- The settings log records this switch as well as signup's.
alter table public.app_settings_events alter column signup_open drop not null;
alter table public.app_settings_events add column mfa_required boolean;
alter table public.app_settings_events add constraint app_settings_events_one_setting
  check ((signup_open is null) <> (mfa_required is null));

create or replace function private.log_app_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signup_open is distinct from old.signup_open then
    insert into public.app_settings_events (signup_open, actor) values (new.signup_open, new.updated_by);
  end if;
  if new.operator_mfa_required is distinct from old.operator_mfa_required then
    insert into public.app_settings_events (mfa_required, actor) values (new.operator_mfa_required, new.updated_by);
  end if;
  return new;
end;
$$;


-- Who has an authenticator, and whether it is required. For the console's
-- Security page; an operator only.
create function public.admin_operator_mfa()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_operator_mfa: not a platform admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'required', (select s.operator_mfa_required from public.app_settings s where s.id),
    'your_level', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'operators', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', u.email,
               'you', a.user_id = (select auth.uid()),
               'has_factor', exists (select 1 from auth.mfa_factors f
                                      where f.user_id = a.user_id and f.status = 'verified')
             ) order by u.email)
        from public.platform_admins a join auth.users u on u.id = a.user_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_operator_mfa() from public, anon;
grant execute on function public.admin_operator_mfa() to authenticated;


create function public.admin_set_operator_mfa(p_required boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_operator_mfa: not a platform admin' using errcode = '42501';
  end if;
  -- Either way: a stolen password must not be able to switch it off.
  if coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'admin_set_operator_mfa: sign in with your authenticator code first' using errcode = '42501';
  end if;
  if p_required is null then
    raise exception 'admin_set_operator_mfa: required or not' using errcode = '22023';
  end if;
  if p_required then
    select string_agg(u.email, ', ' order by u.email) into v_missing
      from public.platform_admins a join auth.users u on u.id = a.user_id
     where not exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified');
    if v_missing is not null then
      raise exception 'admin_set_operator_mfa: these operators have no authenticator yet and would be locked out: %', v_missing
        using errcode = '22023';
    end if;
  end if;
  update public.app_settings
     set operator_mfa_required = p_required, updated_by = (select auth.uid()), updated_at = now()
   where id;
end;
$$;

revoke all on function public.admin_set_operator_mfa(boolean) from public, anon;
grant execute on function public.admin_set_operator_mfa(boolean) to authenticated;


-- The activity log names the new switch.
create or replace function public.admin_activity(p_limit integer default 300)
returns table (
  at       timestamptz,
  actor    text,
  action   text,
  subject  text,
  detail   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_activity: not a platform admin' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 2000 then
    raise exception 'admin_activity: 1 to 2000 rows' using errcode = '22023';
  end if;

  return query
  -- auth.users.email is varchar; the declared columns are text.
  select x.at, coalesce(a.email, 'a deleted account')::text, x.action::text, x.subject::text, x.detail::text
  from (
    select s.created_at as at, s.admin_user_id as actor, 'opened an account' as action,
           coalesce(u.email, 'a deleted account')::text as subject, s.reason as detail
      from public.support_access s left join auth.users u on u.id = s.subject_user_id
    union all
    select p.created_at, p.admin_user_id, 'provisioned an account', p.email,
           p.role || ' of ' || coalesce(p.company_name, co.name, 'a company')
             || case when p.completed_at is null then ' (not completed)' else '' end
      from public.account_provisioning p left join public.companies co on co.id = p.company_id
    union all
    select d.created_at, d.admin_user_id, 'deleted an account', 'account ' || left(d.email_sha256, 8), d.reason
      from public.account_deletions d
    union all
    select e.at, e.actor, 'set a plan', co.name, coalesce(e.from_plan, 'none') || ' → ' || coalesce(e.to_plan, 'none')
      from public.subscription_events e join public.companies co on co.id = e.company_id
     where e.source = 'operator'
    union all
    select co.closed_at, co.closed_by, 'closed a company', co.name, co.closed_reason
      from public.companies co where co.closed_at is not null
    union all
    select r.resolved_at, r.resolved_by,
           case r.resolution when 'added' then 'added a requested teammate' else 'declined a teammate request' end,
           r.email, co.name || coalesce(': ' || r.resolution_note, '')
      from public.access_requests r join public.companies co on co.id = r.company_id
     where r.resolved_at is not null
       and exists (select 1 from public.platform_admins pa where pa.user_id = r.resolved_by)
    union all
    select m.changed_at, m.changed_by, 'changed a role', m.email, co.name || ': ' || m.from_role || ' → ' || m.to_role
      from public.membership_role_changes m join public.companies co on co.id = m.company_id
     where exists (select 1 from public.platform_admins pa where pa.user_id = m.changed_by)
    union all
    select g.at, g.actor,
           case
             when g.mfa_required is not null then
               case when g.mfa_required then 'required two-step sign-in' else 'stopped requiring two-step sign-in' end
             when g.signup_open then 'opened signup'
             else 'closed signup'
           end,
           case when g.mfa_required is not null then 'operators' else 'self-serve signup' end,
           null
      from public.app_settings_events g
  ) x
  left join auth.users a on a.id = x.actor
  order by x.at desc
  limit p_limit;
end;
$$;
