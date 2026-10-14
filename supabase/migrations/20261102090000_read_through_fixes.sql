-- Fixes from reading the whole project through (2026-10-14).
--
--   1. "Find insights in this call" disappeared from any call whose action
--      items or follow-up had been drafted. conversation_pipeline counted
--      every T3 row on a call as an extraction run, and action items and the
--      follow-up are T3 too, so the call read as "extracted, found nothing"
--      and the button was hidden. Only the extractor's own rows count now.
--   2. A row from another company reaching code that asked for one is its
--      own kind of failure, `tenant_boundary`, and raises the alarm the first
--      time: under any other name it was `unknown`, which never alarms, and
--      the Ask agent swallowed it entirely. ops_digest says the same as
--      `pnpm health` (packages/db/src/health.ts; a test holds them together),
--      and no longer counts access requests for closed companies, which the
--      console already leaves out and nobody can resolve.
--   3. The console's health page judged every company against one seat's
--      allowance, so a team of five on Pro at 30 of its 125 calls read as
--      30 of 25. It reads private.company_limit, as every other reader of a
--      limit has since plans went per seat.
--   4. A support session could set the customer's password, and then sign
--      in with it after its window closed: a password session is never asked
--      whether it is a support session, and one made after the window is not
--      counted as one. The web app now asks before a password is set, with
--      in_support_session(), the private check made callable for one's own
--      session only.

-- 1 ---------------------------------------------------------------------------

create or replace function public.conversation_pipeline(p_company_id uuid default null)
returns table (
  conversation_id  uuid,
  segments         integer,
  embedded         integer,
  signals          integer,
  criterion_rows   integer,
  extraction_runs  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if (select auth.uid()) is not null
     and not (select private.is_company_member(v_company_id)) then
    raise exception 'conversation_pipeline: not a member of that company'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    (select count(*)::integer from public.segments s where s.conversation_id = c.id),
    (select count(*)::integer
       from public.segments s
       join public.segment_embeddings e on e.segment_id = s.id
      where s.conversation_id = c.id),
    (select count(*)::integer from public.signals g where g.conversation_id = c.id),
    (select count(*)::integer from public.criterion_events k where k.conversation_id = c.id),
    -- The extractor's family, not its version: a version bump must not make
    -- every conversation look unextracted again, and the other T3 work on a
    -- call (action items, the follow-up) is not extraction. A row with no
    -- detector is from before detectors were recorded, and counts as it did.
    (select count(*)::integer
       from public.model_usage u
      where u.conversation_id = c.id and u.tier = 't3'
        and (u.detector is null or u.detector like 't3-extract@%'))
  from public.conversations c
  where c.company_id = v_company_id;
end;
$$;


-- 2 ---------------------------------------------------------------------------

alter table public.system_failures drop constraint system_failures_kind_check;
alter table public.system_failures add constraint system_failures_kind_check check (kind in (
  'model_rejected',
  'model_unavailable',
  'billing',
  'database',
  'input',
  -- One company's row where another's was asked for (invariant 4).
  'tenant_boundary',
  'unknown'
));

create or replace function public.ops_digest(p_token text, p_hours integer default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if p_token is null or not exists (
    select 1 from private.ops_tokens t
     where t.revoked_at is null and t.token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise exception 'ops_digest: not a current token' using errcode = '42501';
  end if;
  if p_hours is null or p_hours not between 1 and 168 then
    raise exception 'ops_digest: p_hours is 1 to 168' using errcode = '22023';
  end if;
  update private.ops_tokens set last_used = now() where revoked_at is null;
  v_since := now() - make_interval(hours => p_hours);

  return jsonb_build_object(
    'hours', p_hours,
    'at', now(),
    -- Grouped as `pnpm health` groups them: kind, where, upstream status.
    'failures', coalesce((
      select jsonb_agg(g order by g.needs_a_person desc, g.count desc)
        from (
          select f.kind, f.source, f.status, count(*)::int as count, max(f.created_at) as last,
                 f.kind in ('model_rejected', 'database', 'billing', 'tenant_boundary') as needs_a_person
            from public.system_failures f
           where f.created_at >= v_since
           group by f.kind, f.source, f.status
        ) g), '[]'::jsonb),
    -- An actionable group repeated ALARM_AT (2) times or more, or of a kind
    -- that alarms the first time (ALARM_AT_ONCE).
    'alarming', coalesce((
      select sum(g.count)::int from (
        select count(*) as count from public.system_failures f
         where f.created_at >= v_since and f.kind in ('model_rejected', 'database', 'billing', 'tenant_boundary')
         group by f.kind, f.source, f.status having count(*) >= 2 or f.kind = 'tenant_boundary'
      ) g), 0),
    'billing', exists (select 1 from public.system_failures f where f.created_at >= v_since and f.kind = 'billing'),
    'new_companies', (select count(*)::int from public.companies c where c.created_at >= v_since),
    'waiting', jsonb_build_object(
      -- A closed company's request can never be resolved; the console leaves
      -- them out, and so does this.
      'access_requests', (select count(*)::int from public.access_requests r
                            join public.companies c on c.id = r.company_id
                           where r.resolved_at is null and c.closed_at is null),
      'deletion_requests', (select count(*)::int from public.account_deletion_requests r where r.resolved_at is null),
      'provisioning', (select count(*)::int from public.account_provisioning p where p.completed_at is null)
    ),
    'spend_usd', jsonb_build_object(
      'window', coalesce((select round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 2)
                            from public.model_usage u where u.created_at >= v_since), 0),
      'last_7_days', coalesce((select round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 2)
                                 from public.model_usage u where u.created_at >= now() - interval '7 days'), 0)
    )
  );
end;
$$;


-- 3 ---------------------------------------------------------------------------

create or replace function public.admin_company_health()
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
  -- This period's use against the company's limits (the plan's per seat,
  -- times its seats), per meter; a null limit is unlimited.
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
    coalesce(private.company_limit(c.id, 'calls'), p.calls),
    coalesce((select sum(l.amount) from public.usage_ledger l
               where l.company_id = c.id and l.meter = 'extractions' and l.refunded_at is null
                 and l.period_start = s.period_start), 0),
    coalesce(private.company_limit(c.id, 'extractions'), p.extractions),
    coalesce((select sum(l.amount) from public.usage_ledger l
               where l.company_id = c.id and l.meter = 'live_seconds' and l.refunded_at is null
                 and l.period_start = s.period_start), 0),
    coalesce(private.company_limit(c.id, 'live_seconds'), p.live_minutes * 60),
    s.period_end
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id
  left join public.plans p on p.id = c.plan
  order by c.name;
end;
$$;


-- 4 ---------------------------------------------------------------------------

-- Whether the caller's own session began inside a support window. It answers
-- about the session asking and nothing else, so it can be asked by anyone.
create or replace function public.in_support_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.in_support_session();
$$;

revoke all on function public.in_support_session() from public, anon;
grant execute on function public.in_support_session() to authenticated;
