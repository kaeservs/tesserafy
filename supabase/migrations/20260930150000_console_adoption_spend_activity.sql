-- What the console could not answer: are companies getting anywhere, what is
-- the AI costing week by week, and what have operators done.
--
-- Three read functions, each refusing anyone but a platform admin, and one
-- small log. Nothing here writes to customer data.
--
--   admin_adoption()        each company's first call, first insight and first
--                           ticket, for the funnel from company to ticket.
--   admin_spend_by_week()   estimated model spend per week, tier and model, at
--                           the published rates private.usage_usd applies.
--   admin_activity()        one list of what operators did, drawn from the
--                           records each action already writes.
--
-- The signup switch was the one operator action that kept only its latest
-- state (app_settings.updated_by). app_settings_events keeps every change from
-- here on, written by a trigger so no path that flips the switch can skip it.

create table public.app_settings_events (
  id           uuid primary key default gen_random_uuid(),
  signup_open  boolean not null,
  actor        uuid references auth.users (id) on delete set null,
  at           timestamptz not null default now()
);

alter table public.app_settings_events enable row level security;

create policy "admins read settings changes"
  on public.app_settings_events for select to authenticated
  using ((select private.is_platform_admin()));

create function private.log_app_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signup_open is distinct from old.signup_open then
    insert into public.app_settings_events (signup_open, actor) values (new.signup_open, new.updated_by);
  end if;
  return new;
end;
$$;

create trigger app_settings_logged
  after update on public.app_settings
  for each row execute function private.log_app_settings_change();


create function public.admin_adoption()
returns table (
  company_id        uuid,
  name              text,
  plan              text,
  self_serve        boolean,
  created_at        timestamptz,
  closed_at         timestamptz,
  first_call_at     timestamptz,
  first_insight_at  timestamptz,
  first_ticket_at   timestamptz,
  calls             bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_adoption: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.created_by is not null,
    c.created_at,
    c.closed_at,
    -- An erased call still happened: its erasure is the latest it could have
    -- been imported, so it counts rather than un-adopting a company.
    least(
      (select min(v.created_at) from public.conversations v where v.company_id = c.id),
      (select min(e.created_at) from public.erasure_events e where e.company_id = c.id)
    ),
    (select min(i.created_at) from public.insights i where i.company_id = c.id),
    (select min(t.created_at) from public.insight_tickets t where t.company_id = c.id),
    (select count(*) from public.conversations v where v.company_id = c.id)
  from public.companies c
  order by c.created_at desc;
end;
$$;

revoke all on function public.admin_adoption() from public, anon;
grant execute on function public.admin_adoption() to authenticated;


create function public.admin_spend_by_week(p_weeks integer default 12)
returns table (
  week      date,
  tier      text,
  model     text,
  detector  text,
  calls     bigint,
  usd       numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_spend_by_week: not a platform admin' using errcode = '42501';
  end if;
  if p_weeks is null or p_weeks not between 1 and 104 then
    raise exception 'admin_spend_by_week: 1 to 104 weeks' using errcode = '22023';
  end if;

  return query
  select
    date_trunc('week', u.created_at at time zone 'utc')::date,
    u.tier,
    u.model,
    coalesce(u.detector, 'unknown'),
    count(*),
    round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 4)
  from public.model_usage u
  where u.created_at >= date_trunc('week', now() at time zone 'utc') - make_interval(weeks => p_weeks - 1)
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
end;
$$;

revoke all on function public.admin_spend_by_week(integer) from public, anon;
grant execute on function public.admin_spend_by_week(integer) to authenticated;


create function public.admin_activity(p_limit integer default 300)
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
  select x.at, coalesce(a.email, 'a deleted account'), x.action, x.subject, x.detail
  from (
    select s.created_at as at, s.admin_user_id as actor, 'opened an account' as action,
           coalesce(u.email, 'a deleted account') as subject, s.reason as detail
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
    select g.at, g.actor, case when g.signup_open then 'opened signup' else 'closed signup' end, 'self-serve signup', null
      from public.app_settings_events g
  ) x
  left join auth.users a on a.id = x.actor
  order by x.at desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_activity(integer) from public, anon;
grant execute on function public.admin_activity(integer) to authenticated;
