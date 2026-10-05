-- Plans per seat, Free, and Incognito (ADR 0027).
--
-- The owner's decisions (2026-10-05): every paid plan is priced per seat, and
-- each seat brings its own allowance, so a company's cost to us grows with the
-- seats it pays for; a Free plan, one seat and small, replaces the fourteen-day
-- trial for new companies and is where a cancelled or ended plan lands; and
-- the overlay hides from screen sharing only on Incognito, the plan that pays
-- for it.
--
--   Free       $0, one seat         2 imported calls, 1 Find insights, 0 pattern runs, 5 questions, 10 live minutes
--   Starter    $9.99 a seat         10 / 10 / 4 / 25 / 60 a seat
--   Pro        $19.99 a seat        25 / 25 / 10 / 100 / 180 a seat
--   Incognito  $59.99 a seat        Pro's allowance a seat; the overlay hidden from screen shares
--
-- The trial stays for the companies on it until it ends, and then they are on
-- Free. Pilot and internal are granted, with no seat limit, and hidden.
--
-- Seats: a company may not have more people than its plan allows — one on
-- Free, the seats it pays for on a per-seat plan, no limit on the granted
-- ones. Checked when someone is added, however they are added; a company
-- already over the limit keeps everyone and can add nobody until it has room.
-- While payments are off an owner sets the seats; once paying, Stripe's
-- subscription quantity is the seats, set at checkout and in Stripe's billing
-- page, and its webhook keeps them.
--
-- Every function that reads a plan's limit now reads the company's: the plan's
-- per-seat allowance times its seats (private.company_limit). Those functions
-- are re-made from their last definitions with only that changed.


-- The catalogue -----------------------------------------------------------------

alter table public.plans
  add column per_seat  boolean not null default false,
  add column incognito boolean not null default false,
  add column max_seats integer check (max_seats is null or max_seats > 0);

comment on column public.plans.per_seat is 'Priced, and its allowance given, per seat: the company''s limits are the plan''s times its seats.';
comment on column public.plans.incognito is 'The overlay hides from screen sharing on this plan (ADR 0027).';
comment on column public.plans.max_seats is 'The most people a company on this plan may have, whatever its seats. Null: as many as it pays for, or no limit.';

-- Room in the order for Free and Incognito (rank is unique, checked row by row):
-- everything moves out of the way, the new rows arrive further out, then all
-- take their places.
update public.plans set rank = rank + 100;
insert into public.plans (id, name, price_usd_cents, self_serve, rank, trial_days, calls, extractions, pattern_runs, questions, live_minutes, max_seats)
values ('free', 'Free', null, false, 201, null, 2, 1, 0, 5, 10, 1);
insert into public.plans (id, name, price_usd_cents, self_serve, rank, trial_days, calls, extractions, pattern_runs, questions, live_minutes, per_seat, incognito)
values ('incognito', 'Incognito', 5999, true, 204, null, 25, 25, 10, 100, 180, true, true);
update public.plans set rank = case id
    when 'none' then 0 when 'free' then 1 when 'trial' then 2 when 'basic' then 3 when 'pro' then 4
    when 'incognito' then 5 when 'pilot' then 6 when 'internal' then 7 end;
update public.plans set name = 'Starter', price_usd_cents = 999, per_seat = true where id = 'basic';
update public.plans set price_usd_cents = 1999, per_seat = true where id = 'pro';
update public.plans set incognito = true where id in ('pilot', 'internal');


-- Seats ---------------------------------------------------------------------------

alter table public.subscriptions
  add column seats integer not null default 1 check (seats between 1 and 500);

comment on column public.subscriptions.seats is 'Seats the company has on a per-seat plan: set by an owner while payments are off, by Stripe''s quantity once paying.';

-- Existing companies keep everyone: their seats start at the people they have.
update public.subscriptions s
   set seats = greatest(1, least(500, (select count(*) from public.company_members m where m.company_id = s.company_id)));

alter table public.subscription_events drop constraint subscription_events_kind_check;
alter table public.subscription_events add constraint subscription_events_kind_check check (kind in (
  'started', 'upgraded', 'downgrade_scheduled', 'downgraded',
  'cancel_scheduled', 'change_undone', 'canceled', 'renewed',
  'trial_ended', 'set_by_operator', 'seats_changed'));

-- The most people the company may have now; null for no limit.
create function private.seat_limit(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.max_seats is not null then p.max_seats
              when p.per_seat then s.seats
         end
    from public.companies c
    join public.plans p on p.id = c.plan
    join public.subscriptions s on s.company_id = c.id
   where c.id = p_company_id;
$$;

-- A company's allowance on a meter: its plan's, times its seats on a per-seat plan.
create function private.company_limit(p_company_id uuid, p_meter text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.plan_limit(c.plan, p_meter) * (case when p.per_seat then s.seats else 1 end)
    from public.companies c
    join public.plans p on p.id = c.plan
    join public.subscriptions s on s.company_id = c.id
   where c.id = p_company_id;
$$;

revoke all on function private.seat_limit(uuid) from public, anon, authenticated;
revoke all on function private.company_limit(uuid, text) from public, anon, authenticated;

-- Nobody joins a company without a seat for them, however they are added.
create function private.check_seat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.seat_limit(new.company_id);
begin
  if v_limit is not null
     and (select count(*) from public.company_members m where m.company_id = new.company_id) >= v_limit then
    raise exception 'company_members: every seat on this plan is taken; add a seat first' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger company_members_check_seat
  before insert on public.company_members
  for each row execute function private.check_seat();

-- An owner sets the seats while payments are off; once paying, it is Stripe's
-- quantity, changed in Stripe's billing page.
create function public.change_seats(p_seats integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_plan       public.plans;
  v_members    integer;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'change_seats: only an owner can change the seats' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.per_seat then
    raise exception 'change_seats: seats come with Starter, Pro or Incognito' using errcode = '22023';
  end if;
  if v_sub.provider = 'stripe' then
    raise exception 'change_seats: you pay through Stripe; change the seats in billing' using errcode = '22023';
  end if;
  select count(*) into v_members from public.company_members m where m.company_id = v_company_id;
  if p_seats is null or p_seats < greatest(v_members, 1) or p_seats > 500 then
    raise exception 'change_seats: at least one for everyone in the company (%), and at most 500', v_members using errcode = '22023';
  end if;
  update public.subscriptions set seats = p_seats, updated_at = now() where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'seats_changed', v_plan.id, v_plan.id, 'owner', v_uid);
  return p_seats;
end;
$$;

revoke all on function public.change_seats(integer) from public, anon;
grant execute on function public.change_seats(integer) to authenticated;


-- Every limit is the company's ------------------------------------------------------

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
  v_limit := private.company_limit(v_company_id, p_meter);

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

create or replace function public.plan_has_allowance(p_meter text)
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
  v_limit := private.company_limit(v_company_id, p_meter);
  if v_limit is null then return true; end if;
  if v_sub.period_end <= now() and v_sub.provider = 'none' then return false; end if;
  select coalesce(sum(l.amount), 0)::integer into v_used
    from public.usage_ledger l
   where l.company_id = v_company_id and l.meter = p_meter
     and l.period_start = v_sub.period_start and l.refunded_at is null;
  return v_used < v_limit;
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
    -- Per seat (ADR 0027): how many the company pays for, how many it uses,
    -- and the most it may have; whether its overlay hides from screen shares.
    'per_seat', v_plan.per_seat,
    'seats', v_sub.seats,
    'members', (select count(*) from public.company_members m where m.company_id = v_company_id),
    'seat_limit', private.seat_limit(v_company_id),
    'incognito', v_plan.incognito,
    'meters', (
      select jsonb_agg(jsonb_build_object(
               'meter', m.meter,
               'limit', private.company_limit(v_company_id, m.meter),
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
               'limit', private.company_limit(v_company.id, m.meter),
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


-- Free is where a company lands ------------------------------------------------------

create or replace function public.create_my_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text := trim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'create_my_company: sign in first' using errcode = '42501';
  end if;
  if not (select public.signup_is_open()) then
    raise exception 'create_my_company: sign-up is not open yet' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'create_my_company: confirm your email address first' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_uid) then
    raise exception 'create_my_company: you already belong to a company' using errcode = '22023';
  end if;
  if exists (select 1 from public.companies c where c.created_by = v_uid) then
    raise exception 'create_my_company: this account has already created a company' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'create_my_company: a company name is 2 to 100 characters' using errcode = '22023';
  end if;

  -- A company starts on Free (ADR 0027), and its subscription by itself:
  -- companies_start_subscription (20260928090000).
  insert into public.companies (name, plan, created_by)
  values (v_name, 'free', v_uid)
  returning id into v_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

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

create or replace function public.change_plan(p_plan text)
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
    raise exception 'change_plan: choose Starter, Pro or Incognito' using errcode = '22023';
  end if;
  if v_current.id in ('pilot', 'internal') then
    raise exception 'change_plan: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;
  if v_sub.provider = 'stripe' then
    raise exception 'change_plan: you pay through Stripe; change the plan in billing' using errcode = '22023';
  end if;

  -- From nothing, Free or the trial: a paid period starts now — through
  -- checkout once payments are on.
  if v_current.id in ('none', 'free', 'trial') then
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
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
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
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

create or replace function public.cancel_plan()
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
  if exists (select 1 from public.subscriptions s where s.company_id = v_company_id and s.provider = 'stripe') then
    raise exception 'cancel_plan: you pay through Stripe; cancel in billing' using errcode = '22023';
  end if;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.self_serve then
    raise exception 'cancel_plan: there is no paid plan to cancel' using errcode = '22023';
  end if;

  update public.subscriptions
     set cancel_at_period_end = true, scheduled_plan = null, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'cancel_scheduled', v_plan.id, 'free', 'owner', v_uid);
end;
$$;

-- Companies with no plan that are not closed are on Free now.
do $$
declare
  v_company uuid;
begin
  for v_company in select c.id from public.companies c where c.plan = 'none' and c.closed_at is null loop
    perform private.apply_plan(v_company, 'free', 'started', 'system', null);
  end loop;
end;
$$;


-- Stripe: the seats are the subscription's quantity; an ended subscription is Free.
drop function private.stripe_sync(uuid, text, timestamptz, timestamptz, boolean, text, text);
create function private.stripe_sync(
  p_company_id      uuid,
  p_plan            text,
  p_period_start    timestamptz,
  p_period_end      timestamptz,
  p_cancel_at_end   boolean,
  p_subscription_id text,
  p_customer_id     text,
  p_seats           integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current  public.plans;
  v_target   public.plans;
  v_sub      public.subscriptions;
begin
  select p.* into v_current from public.plans p join public.companies c on c.plan = p.id where c.id = p_company_id for update of c;
  select * into v_target from public.plans where id = p_plan;
  select * into v_sub from public.subscriptions where company_id = p_company_id for update;

  if v_target.id <> v_current.id then
    update public.companies set plan = v_target.id where id = p_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id,
            case when v_current.id in ('none', 'free', 'trial') then 'started'
                 when v_target.rank > v_current.rank then 'upgraded' else 'downgraded' end,
            v_current.id, v_target.id, 'stripe');
  end if;
  if p_cancel_at_end and not v_sub.cancel_at_period_end then
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id, 'cancel_scheduled', v_target.id, 'free', 'stripe');
  elsif not p_cancel_at_end and v_sub.cancel_at_period_end then
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id, 'change_undone', v_target.id, v_target.id, 'stripe');
  end if;

  update public.subscriptions
     set status = 'active',
         provider = 'stripe',
         provider_subscription_id = p_subscription_id,
         provider_customer_id = coalesce(p_customer_id, provider_customer_id),
         period_start = coalesce(p_period_start, period_start),
         period_end = coalesce(p_period_end, period_end),
         cancel_at_period_end = p_cancel_at_end,
         -- The seats Stripe bills for (the subscription's quantity).
         seats = coalesce(least(greatest(p_seats, 1), 500), seats),
         scheduled_plan = null,
         updated_at = now()
   where company_id = p_company_id;
  return 'synced ' || v_target.id;
end;
$$;

revoke all on function private.stripe_sync(uuid, text, timestamptz, timestamptz, boolean, text, text, integer) from public, anon, authenticated;

create or replace function private.stripe_end(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_plan(p_company_id, 'free', 'canceled', 'stripe', null);
  update public.subscriptions
     set provider = 'none', provider_subscription_id = null, updated_at = now()
   where company_id = p_company_id;
  return 'ended';
end;
$$;

create or replace function public.stripe_event(p_payload text, p_signature text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret   text;
  v_event    jsonb;
  v_obj      jsonb;
  v_type     text;
  v_company  uuid;
  v_plan     text;
  v_item     jsonb;
  v_status   text;
  v_outcome  text;
begin
  select s.webhook_secret into v_secret from private.stripe_settings s where s.id;
  if v_secret is null then
    raise exception 'stripe_event: payments are not set up' using errcode = '55000';
  end if;
  if p_payload is null or length(p_payload) > 1000000 or p_signature is null or length(p_signature) > 2000 then
    raise exception 'stripe_event: not a Stripe event' using errcode = '28000';
  end if;

  if not private.stripe_signature_ok(p_payload, p_signature, v_secret, now()) then
    raise exception 'stripe_event: not signed by Stripe, or not just now' using errcode = '28000';
  end if;

  v_event := p_payload::jsonb;
  v_type := v_event ->> 'type';
  v_obj := v_event -> 'data' -> 'object';
  insert into public.stripe_events (id, type) values (v_event ->> 'id', left(coalesce(v_type, '?'), 100))
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_type = 'checkout.session.completed' then
    v_company := case when coalesce(v_obj ->> 'client_reference_id', '') ~ '^[0-9a-f-]{36}$'
                      then (v_obj ->> 'client_reference_id')::uuid end;
    v_plan := v_obj -> 'metadata' ->> 'plan';
    if v_company is null or not exists (select 1 from public.companies c where c.id = v_company and c.closed_at is null)
       or not exists (select 1 from public.plans p where p.id = v_plan and p.self_serve) then
      v_outcome := 'ignored: no company or plan';
    else
      update public.subscriptions
         set provider_customer_id = coalesce(v_obj ->> 'customer', provider_customer_id),
             updated_at = now()
       where company_id = v_company;
      -- The subscription's own events set the period; this makes sure the
      -- plan starts even if they arrive first or not at all.
      if (select s.provider from public.subscriptions s where s.company_id = v_company) = 'stripe'
         and (select c.plan from public.companies c where c.id = v_company) = v_plan then
        v_outcome := 'already started';
      else
        v_outcome := private.stripe_sync(v_company, v_plan, null, null, false, v_obj ->> 'subscription', v_obj ->> 'customer');
      end if;
    end if;

  elsif v_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    select s.company_id into v_company from public.subscriptions s where s.provider_subscription_id = v_obj ->> 'id';
    if v_company is null and coalesce(v_obj -> 'metadata' ->> 'company_id', '') ~ '^[0-9a-f-]{36}$' then
      select c.id into v_company from public.companies c
       where c.id = (v_obj -> 'metadata' ->> 'company_id')::uuid and c.closed_at is null;
    end if;
    v_item := v_obj -> 'items' -> 'data' -> 0;
    select p.id into v_plan from public.plans p where p.stripe_price_id = v_item -> 'price' ->> 'id';
    v_status := v_obj ->> 'status';

    if v_company is null then
      v_outcome := 'ignored: no company';
    elsif v_type = 'customer.subscription.deleted' or v_status in ('canceled', 'unpaid', 'incomplete_expired') then
      v_outcome := private.stripe_end(v_company);
    elsif v_status in ('active', 'trialing', 'past_due') and v_plan is not null then
      -- Newer Stripe API versions keep the period on the item, older ones on
      -- the subscription.
      v_outcome := private.stripe_sync(
        v_company, v_plan,
        coalesce(private.unix_time(v_obj -> 'current_period_start'), private.unix_time(v_item -> 'current_period_start')),
        coalesce(private.unix_time(v_obj -> 'current_period_end'), private.unix_time(v_item -> 'current_period_end')),
        coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false),
        v_obj ->> 'id', v_obj ->> 'customer',
        case when coalesce(v_item ->> 'quantity', '') ~ '^[0-9]{1,4}$' then (v_item ->> 'quantity')::integer end);
    elsif v_plan is null then
      v_outcome := 'ignored: a price that is no plan';
    else
      v_outcome := 'waiting: ' || coalesce(v_status, '?');
    end if;

  else
    v_outcome := 'ignored';
  end if;

  update public.stripe_events set outcome = left(v_outcome, 100), company_id = v_company where id = v_event ->> 'id';
  return v_outcome;
end;
$$;

drop function public.billing_checkout(text);
create function public.billing_checkout(p_plan text, p_seats integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_current    text;
  v_price      text;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'billing_checkout: only an owner can choose what the company pays for' using errcode = '42501';
  end if;
  if not private.payments_ready() then
    raise exception 'billing_checkout: payments are not open yet' using errcode = '55000';
  end if;
  select p.stripe_price_id into v_price from public.plans p where p.id = p_plan and p.self_serve;
  if v_price is null then
    raise exception 'billing_checkout: choose Basic or Pro' using errcode = '22023';
  end if;
  select c.plan into v_current from public.companies c where c.id = v_company_id;
  if v_current in ('pilot', 'internal') then
    raise exception 'billing_checkout: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company_id;
  if v_sub.provider = 'stripe' then
    raise exception 'billing_checkout: you already pay through Stripe; change the plan in billing' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'company_id', v_company_id,
    'price_id', v_price,
    -- A seat for everyone already in the company, at least (ADR 0027).
    'quantity', least(greatest(coalesce(p_seats, 1), 1,
                      (select count(*)::integer from public.company_members m where m.company_id = v_company_id)), 500),
    'customer_id', v_sub.provider_customer_id,
    'email', (select u.email from auth.users u where u.id = v_uid)
  );
end;
$$;

revoke all on function public.billing_checkout(text, integer) from public, anon;
grant execute on function public.billing_checkout(text, integer) to authenticated;


-- The landing page shows Free beside the plans on sale.
drop policy "visitors read the plans on sale" on public.plans;
create policy "visitors read the plans on sale"
  on public.plans for select to anon
  using (self_serve or id in ('free', 'trial'));
