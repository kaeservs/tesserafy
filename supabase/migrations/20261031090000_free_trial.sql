-- Free becomes a trial (owner, 2026-10-12): one meeting of up to fifteen
-- minutes, once. Fifteen live minutes and one imported call no longer than
-- fifteen minutes, with Free's small extras, and none of it renews.
--
-- Two settings on the catalogue, so the trial stays a row like every other
-- limit:
--
--   renews            false: the allowance is given once. A company's period
--                     on such a plan never ends, so what was used stays used.
--                     Moving to it from another plan starts it afresh, as
--                     moving to any plan does.
--   max_call_minutes  the longest call that may be imported on the plan;
--                     null, no limit. Checked by the import route, which knows
--                     the call's length (apps/web/app/api/transcripts).
--
-- One function now says when a period ends, for a new company, a change of
-- plan and the monthly rollover alike, so "Free does not renew" is decided in
-- one place.

alter table public.plans
  add column renews boolean not null default true,
  add column max_call_minutes integer check (max_call_minutes is null or max_call_minutes > 0);

comment on column public.plans.renews is 'False: the allowance is given once, a trial; the period never ends, so used stays used.';
comment on column public.plans.max_call_minutes is 'The longest call that may be imported on this plan, in minutes; null for no limit.';

update public.plans
   set calls = 1, live_minutes = 15, renews = false, max_call_minutes = 15
 where id = 'free';


create function private.period_end_for(p_plan text, p_from timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
           when p_plan = 'none' then 'infinity'::timestamptz
           when not p.renews then 'infinity'::timestamptz
           when p_plan = 'trial' then p_from + make_interval(days => p.trial_days)
           else p_from + interval '1 month'
         end
    from public.plans p
   where p.id = p_plan;
$$;

revoke all on function private.period_end_for(text, timestamptz) from public, anon, authenticated;


create or replace function private.start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (company_id, status, period_start, period_end)
  values (
    new.id,
    case new.plan when 'none' then 'canceled' when 'trial' then 'trialing' else 'active' end,
    clock_timestamp(),
    coalesce(private.period_end_for(new.plan, clock_timestamp()), clock_timestamp() + interval '1 month')
  );
  insert into public.subscription_events (company_id, kind, to_plan, source, actor)
  values (new.id, 'started', new.plan, 'system', (select auth.uid()));
  return new;
end;
$$;


create or replace function private.apply_plan(
  p_company_id uuid,
  p_plan       text,
  p_kind       text,
  p_source     text,
  p_actor      uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  select c.plan into v_from from public.companies c where c.id = p_company_id for update;

  update public.companies set plan = p_plan where id = p_company_id;

  update public.subscriptions
     set status = case p_plan when 'none' then 'canceled' when 'trial' then 'trialing' else 'active' end,
         period_start = clock_timestamp(),
         period_end = coalesce(private.period_end_for(p_plan, clock_timestamp()), clock_timestamp() + interval '1 month'),
         cancel_at_period_end = false,
         scheduled_plan = null,
         updated_at = now()
   where company_id = p_company_id;

  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (p_company_id, p_kind, v_from, p_plan, p_source, p_actor);
end;
$$;

revoke all on function private.apply_plan(uuid, text, text, text, uuid) from public, anon, authenticated;


-- As in plans_per_seat, with one branch more: a plan that does not renew
-- keeps its period's start, so the ledger rows that count against it still
-- count, and its end moves to never.
create or replace function private.roll_subscription(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub   public.subscriptions;
  v_plan  text;
begin
  select * into v_sub from public.subscriptions where company_id = p_company_id for update;
  if v_sub.company_id is null or v_sub.provider <> 'none' or v_sub.period_end > now() then
    return;
  end if;
  select c.plan into v_plan from public.companies c where c.id = p_company_id;

  if v_sub.status = 'trialing' then
    perform private.apply_plan(p_company_id, 'free', 'trial_ended', 'system', null);
  elsif v_sub.cancel_at_period_end then
    perform private.apply_plan(p_company_id, 'free', 'canceled', 'system', null);
  elsif private.payments_ready() and exists (select 1 from public.plans p where p.id = v_plan and p.self_serve) then
    perform private.apply_plan(p_company_id, 'free', 'canceled', 'system', null);
  elsif v_sub.scheduled_plan is not null then
    perform private.apply_plan(p_company_id, v_sub.scheduled_plan, 'downgraded', 'system', null);
  elsif exists (select 1 from public.plans p where p.id = v_plan and not p.renews) then
    update public.subscriptions
       set period_end = 'infinity'::timestamptz,
           updated_at = now()
     where company_id = p_company_id;
  else
    -- Renewal keeps the plan and moves the period on from where it ended, not
    -- from now: a period is a month of allowance, not a month since the job ran.
    update public.subscriptions
       set period_start = v_sub.period_end,
           period_end = greatest(v_sub.period_end + interval '1 month', now() + interval '1 day'),
           updated_at = now()
     where company_id = p_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id, 'renewed', v_plan, v_plan, 'system');
  end if;
end;
$$;

revoke all on function private.roll_subscription(uuid) from public, anon, authenticated;


-- Companies on Free now: their trial is the period they are in, which no
-- longer ends. What they used this month counts toward it.
update public.subscriptions s
   set period_end = 'infinity'::timestamptz,
       updated_at = now()
  from public.companies c
 where c.id = s.company_id and c.plan = 'free' and s.provider = 'none';
