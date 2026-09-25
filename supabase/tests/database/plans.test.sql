-- Plans: allowances, the owner's changes, the operator's, and what the end of
-- a period does. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email, aud, role) values
  ('abab0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('abab0001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('abab0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('abab0001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'abab0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'abab0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'abab0001-0000-4000-8000-000000000003', 'owner');
insert into public.platform_admins (user_id, note) values
  ('abab0001-0000-4000-8000-000000000004', 'test operator');

create temporary table spent (label text, result jsonb) on commit drop;
grant all on spent to authenticated;

-- The nightly job has no signed-in caller. `reset role` alone keeps the JWT
-- claims, and auth.uid() with them, so each run below clears them first.
--
-- Helpers for moving time: an expired period is simply one whose end has passed.
create function pg_temp.expire(p_company uuid) returns void language sql as $$
  update public.subscriptions set period_end = now() - interval '1 second' where company_id = p_company;
$$;

-- ---------------------------------------------------------------------------
-- A new company starts on the trial
-- ---------------------------------------------------------------------------
select is(
  (select c.plan || '/' || s.status from public.companies c join public.subscriptions s on s.company_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000000a'),
  'trial/trialing',
  'a company that exists has a subscription, on the trial'
);

insert into public.companies (id, name) values ('00000000-0000-4000-8000-0000000000cc', 'Brand New');
select ok(
  (select status = 'trialing' and period_end between now() + interval '13 days' and now() + interval '15 days'
     from public.subscriptions where company_id = '00000000-0000-4000-8000-0000000000cc'),
  'and one created now gets a fourteen-day trial, whichever path created it'
);

-- ---------------------------------------------------------------------------
-- Spending the trial's allowance
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000002","role":"authenticated"}', true);

insert into spent select 'c1', public.take_plan_allowance('calls');
insert into spent select 'c2', public.take_plan_allowance('calls');
insert into spent select 'c3', public.take_plan_allowance('calls');
insert into spent select 'c4', public.take_plan_allowance('calls');

select is(
  (select string_agg((result ->> 'allowed'), ',' order by label) from spent),
  'true,true,true,false',
  'a member spends the trial''s three calls, and the fourth is refused'
);
select is(
  (select result ->> 'limit' || '/' || (result ->> 'used') from spent where label = 'c4'),
  '3/3',
  'saying what the limit is and what has been used'
);

select ok(not public.plan_has_allowance('calls'), 'checking without spending says there is none left');

select lives_ok(
  $$ select public.refund_plan_allowance((select (result ->> 'ledger_id')::bigint from spent where label = 'c3')) $$,
  'the person who spent one can have it back when the work failed'
);
select is(
  (public.take_plan_allowance('calls') ->> 'allowed')::boolean,
  true,
  'so there is one to spend again'
);

select is(
  (public.take_plan_allowance('live_seconds', 30) ->> 'used')::integer,
  30,
  'live time is spent in seconds'
);

select throws_ok(
  $$ select public.take_plan_allowance('gpu_hours') $$,
  '22023', null,
  'an unknown meter is refused'
);

-- ---------------------------------------------------------------------------
-- The owner changes plan
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.change_plan('basic') $$,
  '42501', null,
  'a member cannot change the plan'
);

select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.change_plan('pilot') $$,
  '22023', null,
  'nor choose a plan that is not sold'
);

select is(public.change_plan('basic'), 'started', 'trial to Basic starts a paid period');
select is(
  (public.take_plan_allowance('calls') ->> 'used')::integer,
  1,
  'with a fresh allowance: the trial''s calls do not count against it'
);

select is(public.change_plan('pro'), 'upgraded', 'Basic to Pro is an upgrade, now');
select is(
  (public.take_plan_allowance('calls') ->> 'limit' || '/' || (public.take_plan_allowance('calls') ->> 'used')),
  '25/3',
  'more allowance straight away, in the same period'
);

select is(public.change_plan('basic'), 'downgrade_scheduled', 'Pro to Basic waits for the period to end');
select is(
  (select c.plan || '/' || s.scheduled_plan from public.companies c join public.subscriptions s on s.company_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000000a'),
  'pro/basic',
  'keeping Pro until then'
);

select is(public.change_plan('pro'), 'kept', 'choosing Pro again undoes the downgrade');

select lives_ok($$ select public.cancel_plan() $$, 'the owner cancels');
select ok(
  (select cancel_at_period_end from public.subscriptions where company_id = '00000000-0000-4000-8000-00000000000a'),
  'which also waits for the period to end'
);

-- ---------------------------------------------------------------------------
-- The end of a period
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.expire('00000000-0000-4000-8000-00000000000a');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (public.take_plan_allowance('calls') ->> 'allowed')::boolean,
  false,
  'past the end of a cancelled period there is nothing to spend'
);
select is(
  (select c.plan || '/' || s.status from public.companies c join public.subscriptions s on s.company_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000000a'),
  'none/canceled',
  'the company has no plan, and knows it the moment it asks'
);

select is(public.change_plan('basic'), 'started', 'and can start one again');

select is(public.change_plan('pro'), 'upgraded', 'Pro again');
select is(public.change_plan('basic'), 'downgrade_scheduled', 'then a downgrade');
reset role;
select pg_temp.expire('00000000-0000-4000-8000-00000000000a');
select set_config('request.jwt.claims', '', true);
select public.roll_subscription_periods();
select is(
  (select plan from public.companies where id = '00000000-0000-4000-8000-00000000000a'),
  'basic',
  'the nightly rollover carries out a scheduled downgrade'
);

select pg_temp.expire('00000000-0000-4000-8000-00000000000a');
select set_config('request.jwt.claims', '', true);
select public.roll_subscription_periods();
select ok(
  (select c.plan = 'basic' and s.status = 'active' and s.period_end > now()
     from public.companies c join public.subscriptions s on s.company_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000000a'),
  'and renews a plan nobody changed'
);

select pg_temp.expire('00000000-0000-4000-8000-0000000000cc');
select set_config('request.jwt.claims', '', true);
select public.roll_subscription_periods();
select is(
  (select plan from public.companies where id = '00000000-0000-4000-8000-0000000000cc'),
  'none',
  'a trial that runs out ends'
);

select is(
  (select count(*)::integer from public.subscription_events
    where company_id = '00000000-0000-4000-8000-00000000000a' and source = 'owner'),
  8,
  'every change the owner made is in the history: started, upgraded, downgrade scheduled, undone, cancel scheduled, started, upgraded, downgrade scheduled'
);
select is(
  (select string_agg(distinct kind, ',' order by kind) from public.subscription_events
    where company_id = '00000000-0000-4000-8000-00000000000a' and source = 'system' and kind <> 'started'),
  'canceled,downgraded,renewed',
  'and so is everything the end of a period did'
);

-- ---------------------------------------------------------------------------
-- The operator
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_set_plan('00000000-0000-4000-8000-00000000000b', 'pilot') $$,
  '42501', null,
  'an owner cannot grant themselves a plan'
);

select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.admin_set_plan('00000000-0000-4000-8000-00000000000b', 'pilot') $$,
  'the operator grants a pilot'
);

select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select ok(
  (public.take_plan_allowance('pattern_runs') ->> 'limit') is null,
  'a pilot has no monthly limit'
);
select throws_ok(
  $$ select public.change_plan('basic') $$,
  '22023', null,
  'and its owner cannot swap it for Basic themselves'
);

select is(
  jsonb_array_length(public.plan_overview() -> 'meters'),
  4,
  'the overview reports all four meters'
);

-- ---------------------------------------------------------------------------
-- Closing, and provisioning
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select public.close_company('00000000-0000-4000-8000-00000000000b', 'pilot ended', 'Globex Logistics');
reset role;
select is(
  (select c.plan || '/' || s.status from public.companies c join public.subscriptions s on s.company_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000000b'),
  'none/canceled',
  'closing a company ends its plan'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"abab0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.open_account_provisioning('new@brand.example', 'owner', p_company_name => 'Brand', p_plan => 'basic') $$,
  'provisioning accepts Basic'
);

select * from finish();
rollback;
