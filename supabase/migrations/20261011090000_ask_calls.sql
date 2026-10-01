-- "Ask your calls" (ADR 0018): a question answered from the company's own calls
-- and documents by an agent. Each question is several model calls, so it has
-- an allowance of its own, beside the four there are: a row per plan, so the
-- numbers change without a deploy.
--
-- Provisional, like the others until real questions are metered: about
-- $0.04-0.10 a question on Sonnet 5 with the cache engaged, so Basic's 25 is
-- under $2.50 of its $9 and Pro's 100 under $10 of its $20.

alter table public.plans
  add column questions integer check (questions is null or questions >= 0);

update public.plans set questions = case id
  when 'none'  then 0
  when 'trial' then 10
  when 'basic' then 25
  when 'pro'   then 100
  else null
end;

alter table public.usage_ledger drop constraint usage_ledger_meter_check;
alter table public.usage_ledger add constraint usage_ledger_meter_check
  check (meter in ('calls', 'extractions', 'pattern_runs', 'live_seconds', 'questions'));

create or replace function private.plan_limit(p_plan text, p_meter text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case p_meter
           when 'calls'        then p.calls
           when 'extractions'  then p.extractions
           when 'pattern_runs' then p.pattern_runs
           when 'questions'    then p.questions
           when 'live_seconds' then p.live_minutes * 60
         end
    from public.plans p where p.id = p_plan;
$$;

create or replace function public.take_plan_allowance(p_meter text, p_amount integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_plan       text;
  v_limit      integer;
  v_used       integer;
  v_id         bigint;
  v_token      text;
begin
  if p_meter not in ('calls', 'extractions', 'pattern_runs', 'live_seconds', 'questions') then
    raise exception 'take_plan_allowance: no meter %', p_meter using errcode = '22023';
  end if;
  -- One of anything; live time by the utterance, 5 to 30 seconds (lib/plan).
  if p_amount is null or (p_meter <> 'live_seconds' and p_amount <> 1)
     or (p_meter = 'live_seconds' and p_amount not between 1 and 60) then
    raise exception 'take_plan_allowance: that amount is not one this meter takes' using errcode = '22023';
  end if;

  perform private.roll_subscription(v_company_id);

  -- Locked, so two requests for the last unit of an allowance queue here and
  -- the second sees the first's row.
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select c.plan into v_plan from public.companies c where c.id = v_company_id;
  v_limit := private.plan_limit(v_plan, p_meter);

  select coalesce(sum(l.amount), 0)::integer into v_used
    from public.usage_ledger l
   where l.company_id = v_company_id and l.meter = p_meter
     and l.period_start = v_sub.period_start and l.refunded_at is null;

  if v_limit is not null and v_used + p_amount > v_limit then
    return jsonb_build_object(
      'allowed', false, 'meter', p_meter, 'used', v_used, 'limit', v_limit,
      'plan', v_plan, 'status', v_sub.status, 'resets_at', v_sub.period_end);
  end if;

  insert into public.usage_ledger (company_id, meter, amount, period_start, user_id)
  values (v_company_id, p_meter, p_amount, v_sub.period_start, (select auth.uid()))
  returning id into v_id;

  -- The refund token goes back to whoever called, once; only its hash stays.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into private.plan_refund_tokens (ledger_id, token_hash)
  values (v_id, sha256(convert_to(v_token, 'UTF8')));

  return jsonb_build_object(
    'allowed', true, 'ledger_id', v_id, 'refund_token', v_token, 'meter', p_meter, 'used', v_used + p_amount,
    'limit', v_limit, 'plan', v_plan, 'status', v_sub.status, 'resets_at', v_sub.period_end);
end;
$$;

create or replace function public.plan_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_plan       public.plans;
begin
  perform private.roll_subscription(v_company_id);
  select * into v_sub from public.subscriptions where company_id = v_company_id;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;

  return jsonb_build_object(
    'plan', v_plan.id,
    'plan_name', v_plan.name,
    'price_usd_cents', v_plan.price_usd_cents,
    'self_serve', v_plan.self_serve,
    'status', v_sub.status,
    'period_start', v_sub.period_start,
    'period_end', case when v_sub.period_end = 'infinity'::timestamptz then null else v_sub.period_end end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'scheduled_plan', v_sub.scheduled_plan,
    'meters', (
      select jsonb_agg(jsonb_build_object(
               'meter', m.meter,
               'limit', private.plan_limit(v_plan.id, m.meter),
               'used', coalesce((
                 select sum(l.amount) from public.usage_ledger l
                  where l.company_id = v_company_id and l.meter = m.meter
                    and l.period_start = v_sub.period_start and l.refunded_at is null), 0))
             order by m.ord)
        from (values ('calls', 1), ('extractions', 2), ('pattern_runs', 3), ('questions', 4), ('live_seconds', 5)) as m(meter, ord)
    )
  );
end;
$$;

create or replace function public.admin_company_detail(p_company_id uuid)
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
        from (values ('calls', 1), ('extractions', 2), ('pattern_runs', 3), ('questions', 4), ('live_seconds', 5)) as m(meter, ord)
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
