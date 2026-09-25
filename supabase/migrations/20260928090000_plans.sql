-- Plans, subscriptions, and what each plan allows.
--
-- Until now `companies.plan` was a label an operator typed — "there is no
-- billing system behind it", said its own comment — and every company could
-- spend as much AI as the per-hour abuse limits allowed. This gives the label
-- teeth, before there is a payment provider to collect for it:
--
--   plans           the catalogue. Price and monthly allowances are rows, so
--                   tuning a limit is a data change, not a deploy.
--   subscriptions   one per company: status, the current period, a cancel or
--                   downgrade waiting for the period's end.
--   usage_ledger    every allowance spent, charged in the same statement that
--                   checks it, so two requests cannot both take the last one.
--
-- The owner decided (2026-09-28): Basic $9 and Pro $20, self-serve; until
-- Stripe exists, choosing a plan activates it without payment. So change_plan
-- is callable by owners now. When Stripe lands, starting or upgrading a paid
-- plan moves to checkout and its webhook calls private.apply_plan — the same
-- function this uses — so the rules below do not change, only who may start
-- a paid period.
--
-- Allowances, from measured per-call costs extrapolated to 30-minute calls
-- (T1 scoring ~$0.30–0.50 a call, T3 extraction ~$0.10–0.15, a pattern run
-- ~$0.10–0.20, live ~$1.50 an hour): Basic ≈ $3–6 of AI at full use, Pro
-- ≈ $8–14. Provisional until real calls are metered.
--
-- What an allowance never blocks: reading, search, export, deleting. A plan
-- that ran out, or was cancelled, still owns its data.

create table public.plans (
  id               text primary key,
  name             text not null,
  -- Null: not sold (trial, pilot, internal, none).
  price_usd_cents  integer check (price_usd_cents is null or price_usd_cents > 0),
  -- An owner may choose it themselves. Pilot and internal are granted.
  self_serve       boolean not null default false,
  -- Orders plans so a change is an upgrade or a downgrade.
  rank             integer not null unique,
  -- Only the trial ends by itself.
  trial_days       integer check (trial_days is null or trial_days > 0),
  -- Per billing period. Null: no monthly limit (the per-hour abuse limits
  -- still apply to everyone).
  calls            integer check (calls is null or calls >= 0),
  extractions      integer check (extractions is null or extractions >= 0),
  pattern_runs     integer check (pattern_runs is null or pattern_runs >= 0),
  live_minutes     integer check (live_minutes is null or live_minutes >= 0)
);

comment on table public.plans is
  'The plan catalogue: price and monthly AI allowances. Rows, so a limit changes without a deploy.';

insert into public.plans
  (id, name, price_usd_cents, self_serve, rank, trial_days, calls, extractions, pattern_runs, live_minutes)
values
  ('none',     'No plan',  null, false, 0, null,  0,  0,  0,   0),
  ('trial',    'Trial',    null, false, 1, 14,    3,  3,  1,  15),
  ('basic',    'Basic',     900, true,  2, null, 10, 10,  4,  60),
  ('pro',      'Pro',      2000, true,  3, null, 25, 25, 10, 180),
  ('pilot',    'Pilot',    null, false, 4, null, null, null, null, null),
  ('internal', 'Internal', null, false, 5, null, null, null, null, null);

alter table public.plans enable row level security;

-- The catalogue is what a pricing page shows; nothing in it is private.
create policy "anyone signed in reads the catalogue"
  on public.plans for select to authenticated using (true);


-- The label becomes a reference. 'paid' was never used (no company or
-- provisioning row holds it) and is replaced by the plans that are paid.
alter table public.companies drop constraint companies_plan_check;
alter table public.companies
  add constraint companies_plan_fkey foreign key (plan) references public.plans (id);
comment on column public.companies.plan is
  'The plan in force now. Changed only through private.apply_plan (owners via change_plan, operators via admin_set_plan, later Stripe).';

alter table public.account_provisioning drop constraint account_provisioning_plan_check;
alter table public.account_provisioning
  add constraint account_provisioning_plan_fkey foreign key (plan) references public.plans (id);


create table public.subscriptions (
  company_id            uuid primary key references public.companies (id) on delete cascade,
  status                text not null check (status in ('trialing', 'active', 'canceled')),
  period_start          timestamptz not null,
  -- 'infinity' once canceled: nothing left to roll over.
  period_end            timestamptz not null,
  cancel_at_period_end  boolean not null default false,
  -- A downgrade waits for the period the owner already has to end.
  scheduled_plan        text references public.plans (id),
  -- 'none' until a payment provider manages the period; then its webhooks
  -- move the dates and the nightly rollover leaves the row alone.
  provider              text not null default 'none' check (provider in ('none', 'stripe')),
  provider_customer_id      text,
  provider_subscription_id  text,
  updated_at            timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "members read their company's subscription"
  on public.subscriptions for select to authenticated
  using ((select private.is_company_member(company_id)));
create policy "admins read all subscriptions"
  on public.subscriptions for select to authenticated
  using ((select private.is_platform_admin()));


create table public.subscription_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null check (kind in (
                'started', 'upgraded', 'downgrade_scheduled', 'downgraded',
                'cancel_scheduled', 'change_undone', 'canceled', 'renewed',
                'trial_ended', 'set_by_operator')),
  from_plan   text references public.plans (id),
  to_plan     text references public.plans (id),
  source      text not null check (source in ('owner', 'operator', 'system', 'stripe')),
  actor       uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now()
);

create index subscription_events_company_idx on public.subscription_events (company_id, at desc);

comment on table public.subscription_events is
  'Every change to a company''s plan: what, from what, by whom. Append-only.';

alter table public.subscription_events enable row level security;

create policy "owners read their company's plan history"
  on public.subscription_events for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = subscription_events.company_id
       and m.user_id = (select auth.uid()) and m.role = 'owner'
  ));
create policy "admins read all plan history"
  on public.subscription_events for select to authenticated
  using ((select private.is_platform_admin()));


create table public.usage_ledger (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete cascade,
  meter         text not null check (meter in ('calls', 'extractions', 'pattern_runs', 'live_seconds')),
  amount        integer not null check (amount > 0),
  -- Which period it counts against: the subscription's period_start when spent.
  period_start  timestamptz not null,
  user_id       uuid references auth.users (id) on delete set null,
  at            timestamptz not null default now(),
  -- Set when the AI work it paid for failed: a failed extraction should not
  -- cost the customer their allowance.
  refunded_at   timestamptz
);

create index usage_ledger_period_idx on public.usage_ledger (company_id, meter, period_start);

alter table public.usage_ledger enable row level security;

create policy "members read their company's usage"
  on public.usage_ledger for select to authenticated
  using ((select private.is_company_member(company_id)));
create policy "admins read all usage"
  on public.usage_ledger for select to authenticated
  using ((select private.is_platform_admin()));


-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

create function private.plan_limit(p_plan text, p_meter text)
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
           when 'live_seconds' then p.live_minutes * 60
         end
    from public.plans p where p.id = p_plan;
$$;


-- Put a company on a plan, now. Periods start on the wall clock
-- (clock_timestamp), not the transaction's: two plan changes in one
-- transaction are two periods, and usage must not carry across them.
--
-- The one place a plan changes: owners,
-- operators, the nightly rollover and (later) Stripe all come through here,
-- so a period, a status and an event always change together.
create function private.apply_plan(
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
  v_trial_days integer;
begin
  select c.plan into v_from from public.companies c where c.id = p_company_id for update;
  select p.trial_days into v_trial_days from public.plans p where p.id = p_plan;

  update public.companies set plan = p_plan where id = p_company_id;

  update public.subscriptions
     set status = case p_plan when 'none' then 'canceled' when 'trial' then 'trialing' else 'active' end,
         period_start = clock_timestamp(),
         period_end = case p_plan
                        when 'none' then 'infinity'::timestamptz
                        when 'trial' then clock_timestamp() + make_interval(days => v_trial_days)
                        else clock_timestamp() + interval '1 month'
                      end,
         cancel_at_period_end = false,
         scheduled_plan = null,
         updated_at = now()
   where company_id = p_company_id;

  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (p_company_id, p_kind, v_from, p_plan, p_source, p_actor);
end;
$$;

revoke all on function private.apply_plan(uuid, text, text, text, uuid) from public, anon, authenticated;


-- Past a period's end: end the trial, carry out a cancel or a downgrade, or
-- renew. Lazily, from take_plan_allowance, so nobody gets a free day waiting
-- for the nightly job; and nightly, for companies nobody is using.
create function private.roll_subscription(p_company_id uuid)
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
    perform private.apply_plan(p_company_id, 'none', 'trial_ended', 'system', null);
  elsif v_sub.cancel_at_period_end then
    perform private.apply_plan(p_company_id, 'none', 'canceled', 'system', null);
  elsif v_sub.scheduled_plan is not null then
    perform private.apply_plan(p_company_id, v_sub.scheduled_plan, 'downgraded', 'system', null);
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


-- Every company has a subscription from the moment it exists, whichever path
-- created it.
create function private.start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial_days integer;
begin
  select p.trial_days into v_trial_days from public.plans p where p.id = new.plan;
  insert into public.subscriptions (company_id, status, period_start, period_end)
  values (
    new.id,
    case new.plan when 'none' then 'canceled' when 'trial' then 'trialing' else 'active' end,
    clock_timestamp(),
    case new.plan
      when 'none' then 'infinity'::timestamptz
      when 'trial' then clock_timestamp() + make_interval(days => v_trial_days)
      else clock_timestamp() + interval '1 month'
    end
  );
  insert into public.subscription_events (company_id, kind, to_plan, source, actor)
  values (new.id, 'started', new.plan, 'system', (select auth.uid()));
  return new;
end;
$$;

create trigger companies_start_subscription
  after insert on public.companies
  for each row execute function private.start_subscription();

-- The companies that already exist. A closed company has no plan to spend.
insert into public.subscriptions (company_id, status, period_start, period_end)
select c.id,
       case when c.closed_at is not null then 'canceled'
            when c.plan = 'trial' then 'trialing' else 'active' end,
       now(),
       case when c.closed_at is not null then 'infinity'::timestamptz
            when c.plan = 'trial' then now() + interval '14 days'
            else now() + interval '1 month' end
  from public.companies c
 where not exists (select 1 from public.subscriptions s where s.company_id = c.id);

update public.companies set plan = 'none' where closed_at is not null;


-- ---------------------------------------------------------------------------
-- Spending an allowance
-- ---------------------------------------------------------------------------

create function public.take_plan_allowance(p_meter text, p_amount integer default 1)
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
begin
  if p_meter not in ('calls', 'extractions', 'pattern_runs', 'live_seconds') then
    raise exception 'take_plan_allowance: no meter %', p_meter using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'take_plan_allowance: amount must be positive' using errcode = '22023';
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

  return jsonb_build_object(
    'allowed', true, 'ledger_id', v_id, 'meter', p_meter, 'used', v_used + p_amount,
    'limit', v_limit, 'plan', v_plan, 'status', v_sub.status, 'resets_at', v_sub.period_end);
end;
$$;

revoke all on function public.take_plan_allowance(text, integer) from public, anon;
grant execute on function public.take_plan_allowance(text, integer) to authenticated;


-- Give back what a failed piece of AI work took. Only the person who spent
-- it, only once, and only within the hour: a refund is for the request that
-- just failed, not a way to reset a month.
create function public.refund_plan_allowance(p_ledger_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.usage_ledger
     set refunded_at = now()
   where id = p_ledger_id
     and user_id = (select auth.uid())
     and refunded_at is null
     and at > now() - interval '1 hour';
end;
$$;

revoke all on function public.refund_plan_allowance(bigint) from public, anon;
grant execute on function public.refund_plan_allowance(bigint) to authenticated;


-- Whether a meter has anything left, without spending it. For live
-- suggestions, which ride on detections already paid for.
create function public.plan_has_allowance(p_meter text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_limit      integer;
  v_used       integer;
begin
  select * into v_sub from public.subscriptions where company_id = v_company_id;
  v_limit := private.plan_limit((select c.plan from public.companies c where c.id = v_company_id), p_meter);
  if v_limit is null then return true; end if;
  if v_sub.period_end <= now() and v_sub.provider = 'none' then return false; end if;
  select coalesce(sum(l.amount), 0)::integer into v_used
    from public.usage_ledger l
   where l.company_id = v_company_id and l.meter = p_meter
     and l.period_start = v_sub.period_start and l.refunded_at is null;
  return v_used < v_limit;
end;
$$;

revoke all on function public.plan_has_allowance(text) from public, anon;
grant execute on function public.plan_has_allowance(text) to authenticated;


-- What the Settings page shows: the plan, its state, and each meter.
create function public.plan_overview()
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
        from (values ('calls', 1), ('extractions', 2), ('pattern_runs', 3), ('live_seconds', 4)) as m(meter, ord)
    )
  );
end;
$$;

revoke all on function public.plan_overview() from public, anon;
grant execute on function public.plan_overview() to authenticated;


-- ---------------------------------------------------------------------------
-- Changing plan, as the owner
-- ---------------------------------------------------------------------------

create function public.change_plan(p_plan text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_current    public.plans;
  v_target     public.plans;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'change_plan: only an owner can change the plan' using errcode = '42501';
  end if;

  perform private.roll_subscription(v_company_id);
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select p.* into v_current from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  select * into v_target from public.plans where id = p_plan;

  if v_target.id is null or not v_target.self_serve then
    raise exception 'change_plan: choose Basic or Pro' using errcode = '22023';
  end if;
  if v_current.id in ('pilot', 'internal') then
    raise exception 'change_plan: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;

  -- From nothing, or from the trial: a paid period starts now. (Free until
  -- Stripe exists; then this path moves to checkout.)
  if v_current.id in ('none', 'trial') then
    perform private.apply_plan(v_company_id, v_target.id, 'started', 'owner', v_uid);
    return 'started';
  end if;

  -- The plan they already have: this is undoing a pending cancel or downgrade.
  if v_target.id = v_current.id then
    if not v_sub.cancel_at_period_end and v_sub.scheduled_plan is null then
      raise exception 'change_plan: you are already on %', v_target.name using errcode = '22023';
    end if;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'change_undone', v_current.id, v_current.id, 'owner', v_uid);
    return 'kept';
  end if;

  -- Up: now, and within the same period — more allowance straight away.
  if v_target.rank > v_current.rank then
    update public.companies set plan = v_target.id where id = v_company_id;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'upgraded', v_current.id, v_target.id, 'owner', v_uid);
    return 'upgraded';
  end if;

  -- Down: at the end of the period they have, which is what they have had.
  update public.subscriptions
     set scheduled_plan = v_target.id, cancel_at_period_end = false, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'downgrade_scheduled', v_current.id, v_target.id, 'owner', v_uid);
  return 'downgrade_scheduled';
end;
$$;

revoke all on function public.change_plan(text) from public, anon;
grant execute on function public.change_plan(text) to authenticated;


create function public.cancel_plan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_plan       public.plans;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'cancel_plan: only an owner can cancel' using errcode = '42501';
  end if;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.self_serve then
    raise exception 'cancel_plan: there is no paid plan to cancel' using errcode = '22023';
  end if;

  update public.subscriptions
     set cancel_at_period_end = true, scheduled_plan = null, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'cancel_scheduled', v_plan.id, 'none', 'owner', v_uid);
end;
$$;

revoke all on function public.cancel_plan() from public, anon;
grant execute on function public.cancel_plan() to authenticated;


-- ---------------------------------------------------------------------------
-- The operator, and the night
-- ---------------------------------------------------------------------------

create function public.admin_set_plan(p_company_id uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_plan: not a platform admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'admin_set_plan: no plan %', p_plan using errcode = '22023';
  end if;
  if exists (select 1 from public.companies where id = p_company_id and closed_at is not null) then
    raise exception 'admin_set_plan: that company is closed' using errcode = '22023';
  end if;
  perform private.apply_plan(p_company_id, p_plan, 'set_by_operator', 'operator', (select auth.uid()));
end;
$$;

revoke all on function public.admin_set_plan(uuid, text) from public, anon;
grant execute on function public.admin_set_plan(uuid, text) to authenticated;


-- Operator-only, like the purge: no signed-in caller, which a cron job is not.
create function public.roll_subscription_periods()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_count   integer := 0;
begin
  if (select auth.uid()) is not null then
    raise exception 'roll_subscription_periods: operator only' using errcode = '42501';
  end if;
  for v_company in
    select s.company_id from public.subscriptions s
     where s.provider = 'none' and s.period_end <= now()
  loop
    perform private.roll_subscription(v_company);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.roll_subscription_periods() from public, anon, authenticated;
grant execute on function public.roll_subscription_periods() to service_role;

select cron.schedule('roll-subscription-periods', '5 0 * * *', $$select public.roll_subscription_periods()$$);


-- A company closed (close_company, 20260927090000) has no plan from then on.
-- A trigger rather than an edit to close_company: that function is long and
-- well tested, and this is one rule that follows from closing, whoever does it.
-- It fires on closed_at only, so apply_plan's own update of `plan` does not
-- set it off again.
create function private.cancel_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.closed_at is null and new.closed_at is not null then
    perform private.apply_plan(new.id, 'none', 'canceled', 'operator', (select auth.uid()));
  end if;
  return new;
end;
$$;

create trigger companies_cancel_on_close
  after update of closed_at on public.companies
  for each row execute function private.cancel_on_close();


-- ---------------------------------------------------------------------------
-- Provisioning accepts the plans that exist
-- ---------------------------------------------------------------------------
-- open_account_provisioning checked a hard-coded list that included 'paid'
-- and not Basic or Pro. It now checks the catalogue (anything but 'none').

create or replace function public.open_account_provisioning(
  p_email        text,
  p_role         text,
  p_company_id   uuid default null,
  p_company_name text default null,
  p_plan         text default 'pilot'
)
returns public.account_provisioning
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := nullif(trim(coalesce(p_company_name, '')), '');
  v_existing uuid;
  v_row   public.account_provisioning;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'open_account_provisioning: not a platform admin' using errcode = '42501';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'open_account_provisioning: that is not an email address' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'open_account_provisioning: role is owner or member' using errcode = '22023';
  end if;
  if (p_company_id is null) = (v_name is null) then
    raise exception 'open_account_provisioning: name a new company or choose an existing one, not both'
      using errcode = '22023';
  end if;
  if v_name is not null and p_role <> 'owner' then
    raise exception 'open_account_provisioning: the first person in a new company is its owner'
      using errcode = '22023';
  end if;
  if v_name is not null and (p_plan is null or p_plan = 'none'
                             or not exists (select 1 from public.plans where id = p_plan)) then
    raise exception 'open_account_provisioning: plan is one of trial, basic, pro, pilot or internal' using errcode = '22023';
  end if;
  if p_company_id is not null
     and not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'open_account_provisioning: no such company' using errcode = '22023';
  end if;

  select u.id into v_existing from auth.users u where lower(u.email) = v_email;
  if v_existing is not null
     and exists (select 1 from public.company_members m where m.user_id = v_existing) then
    raise exception 'open_account_provisioning: % already belongs to a company', v_email
      using errcode = '22023';
  end if;

  insert into public.account_provisioning (admin_user_id, email, role, company_id, company_name, plan)
  values ((select auth.uid()), v_email, p_role, p_company_id, v_name,
          case when v_name is not null then p_plan end)
  returning * into v_row;

  return v_row;
end;
$$;
