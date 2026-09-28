-- Account health and weekly activity, for the console.
--
-- The console could say how many companies exist and how far each got. It
-- could not say which ones need somebody today — gone quiet, about to run out
-- of their plan, failing — or whether companies keep coming back after their
-- first weeks. Two read-only functions, operators only, from what is already
-- recorded. Nothing here reads call content: counts, dates, plan usage.
--
--   admin_company_health()      one row per company: activity, plan usage
--                               against its limits, failures.
--   admin_activity_weeks(n)     which companies did something each week, for
--                               weekly actives and cohort retention.
--
-- "Did something" is adding a call or opening one. Signing in is not counted:
-- a session is not use, and a company that signs in and reads nothing is the
-- one the console should notice.

create function public.admin_company_health()
returns table (
  company_id         uuid,
  name               text,
  plan               text,
  created_at         timestamptz,
  closed_at          timestamptz,
  members            bigint,
  calls_7d           bigint,
  calls_30d          bigint,
  views_7d           bigint,
  last_call_at       timestamptz,
  last_view_at       timestamptz,
  failures_7d        bigint,
  -- This period's use against the plan's limits, per meter; a null limit is unlimited.
  calls_used         bigint,
  calls_limit        integer,
  extractions_used   bigint,
  extractions_limit  integer,
  live_used_seconds  bigint,
  live_limit_seconds integer,
  period_end         timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_company_health: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.created_at,
    c.closed_at,
    (select count(*) from public.company_members m where m.company_id = c.id),
    (select count(*) from public.conversations v where v.company_id = c.id and v.created_at > now() - interval '7 days'),
    (select count(*) from public.conversations v where v.company_id = c.id and v.created_at > now() - interval '30 days'),
    (select count(*) from public.conversation_views w
      where w.company_id = c.id and not w.during_support and w.viewed_at > now() - interval '7 days'),
    (select max(v.created_at) from public.conversations v where v.company_id = c.id),
    (select max(w.viewed_at) from public.conversation_views w where w.company_id = c.id and not w.during_support),
    (select count(*) from public.system_failures f where f.company_id = c.id and f.created_at > now() - interval '7 days'),
    coalesce((select sum(l.amount) from public.usage_ledger l
               where l.company_id = c.id and l.meter = 'calls' and l.refunded_at is null
                 and l.period_start = s.period_start), 0),
    p.calls,
    coalesce((select sum(l.amount) from public.usage_ledger l
               where l.company_id = c.id and l.meter = 'extractions' and l.refunded_at is null
                 and l.period_start = s.period_start), 0),
    p.extractions,
    coalesce((select sum(l.amount) from public.usage_ledger l
               where l.company_id = c.id and l.meter = 'live_seconds' and l.refunded_at is null
                 and l.period_start = s.period_start), 0),
    p.live_minutes * 60,
    s.period_end
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id
  left join public.plans p on p.id = c.plan
  order by c.name;
end;
$$;

revoke all on function public.admin_company_health() from public, anon;
grant execute on function public.admin_company_health() to authenticated;


create function public.admin_activity_weeks(p_weeks integer default 12)
returns table (company_id uuid, week date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_activity_weeks: not a platform admin' using errcode = '42501';
  end if;
  if p_weeks is null or p_weeks not between 1 and 104 then
    raise exception 'admin_activity_weeks: 1 to 104 weeks' using errcode = '22023';
  end if;

  return query
  select distinct x.company_id, date_trunc('week', x.at at time zone 'utc')::date
  from (
    select v.company_id, v.created_at as at from public.conversations v
    union all
    select w.company_id, w.viewed_at from public.conversation_views w where not w.during_support
  ) x
  where x.at >= date_trunc('week', now() at time zone 'utc') - make_interval(weeks => p_weeks - 1);
end;
$$;

revoke all on function public.admin_activity_weeks(integer) from public, anon;
grant execute on function public.admin_activity_weeks(integer) to authenticated;
