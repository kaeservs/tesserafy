-- What the operator console needs to be a dashboard, not only a set of lists.
--
-- Operators belong to no company, so RLS — correctly — shows them no
-- members, calls or companies. Everything the console shows about tenants
-- comes through functions that check is_platform_admin() themselves, as
-- admin_companies and admin_users already do. Two more:
--
--   admin_overview()             the platform at a glance: companies by plan,
--                                trials ending, cancellations pending,
--                                activity, estimated AI spend, failures, and
--                                what is waiting on an operator.
--   admin_company_detail(id)     one company in full: plan and period, usage
--                                against each limit, members, plan history,
--                                requests and exports.
--
-- Read-only, and nothing here returns call content: counts, dates, plans and
-- people. An operator who needs to see a call opens a support session, which
-- is recorded (support_access).

-- Estimated USD for a usage row, at published rates. The same arithmetic as
-- admin_companies, kept in one place for the functions below.
create function private.usage_usd(
  p_model text, p_input bigint, p_cache_creation bigint, p_cache_read bigint, p_output bigint
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (p_input + p_cache_creation * 1.25 + p_cache_read * 0.1) / 1e6
           * case p_model when 'claude-opus-5' then 5 when 'claude-sonnet-5' then 2 else 1 end
         + p_output / 1e6
           * case p_model when 'claude-opus-5' then 25 when 'claude-sonnet-5' then 10 else 5 end;
$$;


create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_overview: not a platform admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'companies', jsonb_build_object(
      'open', (select count(*) from public.companies where closed_at is null),
      'closed', (select count(*) from public.companies where closed_at is not null),
      'by_plan', coalesce((
        select jsonb_object_agg(plan, n) from (
          select c.plan, count(*) as n from public.companies c where c.closed_at is null group by c.plan
        ) p), '{}'::jsonb)
    ),
    'trials_ending', coalesce((
      select jsonb_agg(jsonb_build_object('company_id', c.id, 'name', c.name, 'ends', s.period_end)
                       order by s.period_end)
        from public.companies c join public.subscriptions s on s.company_id = c.id
       where c.closed_at is null and s.status = 'trialing'
         and s.period_end < now() + interval '7 days'), '[]'::jsonb),
    'changes_pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'company_id', c.id, 'name', c.name, 'plan', c.plan, 'ends', s.period_end,
               'change', case when s.cancel_at_period_end then 'cancels' else 'moves to ' || s.scheduled_plan end)
             order by s.period_end)
        from public.companies c join public.subscriptions s on s.company_id = c.id
       where c.closed_at is null and (s.cancel_at_period_end or s.scheduled_plan is not null)), '[]'::jsonb),
    'activity', jsonb_build_object(
      'calls_7d', (select count(*) from public.conversations where created_at > now() - interval '7 days'),
      'calls_30d', (select count(*) from public.conversations where created_at > now() - interval '30 days'),
      'people', (select count(*) from auth.users),
      'people_in_a_company', (select count(distinct user_id) from public.company_members),
      'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days')
    ),
    'spend', jsonb_build_object(
      'usd_7d', coalesce((select round(sum(private.usage_usd(model, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens))::numeric, 2)
                  from public.model_usage where created_at > now() - interval '7 days'), 0),
      'usd_30d', coalesce((select round(sum(private.usage_usd(model, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens))::numeric, 2)
                  from public.model_usage where created_at > now() - interval '30 days'), 0)
    ),
    'failures_24h', (select count(*) from public.system_failures where created_at > now() - interval '24 hours'),
    'waiting', jsonb_build_object(
      'requests', (select count(*) from public.access_requests r join public.companies c on c.id = r.company_id
                    where r.resolved_at is null and c.closed_at is null),
      'unfinished_onboarding', (select count(*) from public.account_provisioning where completed_at is null)
    ),
    'signup_open', (select signup_open from public.app_settings where id)
  );
end;
$$;

revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;


create function public.admin_company_detail(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_sub     public.subscriptions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_company_detail: not a platform admin' using errcode = '42501';
  end if;
  select * into v_company from public.companies where id = p_company_id;
  if v_company.id is null then
    raise exception 'admin_company_detail: no such company' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where company_id = p_company_id;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'plan', v_company.plan,
      'created_at', v_company.created_at, 'closed_at', v_company.closed_at,
      'closed_reason', v_company.closed_reason, 'retention_days', v_company.retention_days,
      'signed_up_by', (select u.email from auth.users u where u.id = v_company.created_by)
    ),
    'subscription', jsonb_build_object(
      'status', v_sub.status,
      'period_start', v_sub.period_start,
      'period_end', case when v_sub.period_end = 'infinity'::timestamptz then null else v_sub.period_end end,
      'cancel_at_period_end', v_sub.cancel_at_period_end,
      'scheduled_plan', v_sub.scheduled_plan
    ),
    'usage', (
      select jsonb_agg(jsonb_build_object(
               'meter', m.meter,
               'limit', private.plan_limit(v_company.plan, m.meter),
               'used', coalesce((select sum(l.amount) from public.usage_ledger l
                                  where l.company_id = p_company_id and l.meter = m.meter
                                    and l.period_start = v_sub.period_start and l.refunded_at is null), 0))
             order by m.ord)
        from (values ('calls', 1), ('extractions', 2), ('pattern_runs', 3), ('live_seconds', 4)) as m(meter, ord)
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role, 'joined', m.created_at,
                                          'last_sign_in', u.last_sign_in_at)
                       order by (m.role = 'owner') desc, u.email)
        from public.company_members m join auth.users u on u.id = m.user_id
       where m.company_id = p_company_id), '[]'::jsonb),
    'calls', jsonb_build_object(
      'total', (select count(*) from public.conversations where company_id = p_company_id),
      'last_30d', (select count(*) from public.conversations
                    where company_id = p_company_id and created_at > now() - interval '30 days'),
      'last', (select max(created_at) from public.conversations where company_id = p_company_id),
      'erased', (select count(*) from public.erasure_events where company_id = p_company_id)
    ),
    'spend_30d', coalesce((
      select round(sum(private.usage_usd(model, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens))::numeric, 2)
        from public.model_usage where company_id = p_company_id and created_at > now() - interval '30 days'), 0),
    'history', coalesce((
      select jsonb_agg(h order by (h ->> 'at') desc) from (
        select jsonb_build_object('kind', e.kind, 'from', e.from_plan, 'to', e.to_plan, 'source', e.source,
                                  'actor', u.email, 'at', e.at) as h
          from public.subscription_events e left join auth.users u on u.id = e.actor
         where e.company_id = p_company_id
         order by e.at desc limit 20) x), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(r order by (r ->> 'created_at') desc) from (
        select jsonb_build_object('email', a.email, 'role', a.role, 'created_at', a.created_at,
                                  'resolution', a.resolution, 'note', a.resolution_note) as r
          from public.access_requests a where a.company_id = p_company_id
         order by a.created_at desc limit 10) x), '[]'::jsonb),
    'exports', coalesce((
      select jsonb_agg(x.e order by (x.e ->> 'requested_at') desc) from (
        select jsonb_build_object('email', ce.email, 'conversations', ce.conversations,
                                  'requested_at', ce.requested_at) as e
          from public.company_exports ce where ce.company_id = p_company_id
         order by ce.requested_at desc limit 5) x), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_company_detail(uuid) from public, anon;
grant execute on function public.admin_company_detail(uuid) to authenticated;
