-- Free is a trial, given once (ADR 0031): one meeting of up to fifteen
-- minutes — fifteen live minutes and one imported call — that does not renew,
-- however long the company stays on Free; moving to a paid plan gives that
-- plan's allowance, and the paid plan renews as before.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select results_eq(
  $$ select calls || ':' || live_minutes || ':' || renews || ':' || coalesce(max_call_minutes::text, '-')
       from public.plans where id in ('free', 'basic') order by rank $$,
  $$ values ('1:15:false:15'), ('10:60:true:-') $$,
  'Free is one imported call of up to fifteen minutes and fifteen live minutes, once; Starter renews with no length limit'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('f7ee0000-0000-4000-8000-000000000001', 'founder@trialco.test', 'authenticated', 'authenticated', now());
update public.app_settings set signup_open = true where id;

create temporary table made (id uuid);
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7ee0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select public.create_my_company('Trialco');

reset role;
select is(
  (select period_end from public.subscriptions where company_id = (select id from made)),
  'infinity'::timestamptz,
  'a new company''s trial has no end, so it never renews'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7ee0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((public.take_plan_allowance('calls') ->> 'allowed')::boolean, true, 'the one imported call is there');
select is((public.take_plan_allowance('calls') ->> 'allowed')::boolean, false, 'and a second is not');
select is((public.take_plan_allowance('live_seconds', 60) ->> 'limit')::integer, 900, 'fifteen live minutes');

-- A month later, and the nightly job runs: nothing comes back.
reset role;
update public.subscriptions set period_end = now() - interval '1 minute' where company_id = (select id from made);
select set_config('request.jwt.claims', '', true);
select public.roll_subscription_periods();
select is(
  (select period_end from public.subscriptions where company_id = (select id from made)),
  'infinity'::timestamptz,
  'the rollover gives Free no new period'
);
select is(
  (select count(*)::integer from public.subscription_events where company_id = (select id from made) and kind = 'renewed'),
  0,
  'and records no renewal'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7ee0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((public.take_plan_allowance('calls') ->> 'allowed')::boolean, false, 'so the trial''s call stays used');

-- Starting a paid plan gives its allowance, and it renews.
select is(public.change_plan('basic'), 'started', 'the owner starts Starter');
select is((public.take_plan_allowance('calls') ->> 'allowed')::boolean, true, 'with its own imported calls');
reset role;
select ok(
  (select period_end < 'infinity'::timestamptz and period_end > now() from public.subscriptions where company_id = (select id from made)),
  'and a period that ends and renews'
);

select * from finish();
rollback;
