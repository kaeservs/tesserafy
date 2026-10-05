-- Plans per seat, Free and Incognito (ADR 0027): the catalogue; a new company
-- starts on Free, one seat; nobody joins without a seat; an owner sets seats
-- (not below the people there) and each seat brings its allowance; Incognito
-- is the plan that hides the overlay; a cancelled plan lands on Free. Runs
-- with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select results_eq(
  $$ select id || ':' || coalesce(price_usd_cents::text, '-') || ':' || per_seat || ':' || incognito || ':' || coalesce(max_seats::text, '-')
       from public.plans where id in ('free', 'basic', 'pro', 'incognito') order by rank $$,
  $$ values ('free:-:false:false:1'), ('basic:999:true:false:-'), ('pro:1999:true:false:-'), ('incognito:5999:true:true:-') $$,
  'Free is one seat; Starter, Pro and Incognito are per seat at 9.99, 19.99 and 59.99; only Incognito hides'
);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('5ea70000-0000-4000-8000-000000000001', 'founder@newco.test', 'authenticated', 'authenticated', now()),
  ('5ea70000-0000-4000-8000-000000000002', 'second@newco.test', 'authenticated', 'authenticated', now()),
  ('5ea70000-0000-4000-8000-000000000003', 'third@newco.test', 'authenticated', 'authenticated', now());
update public.app_settings set signup_open = true where id;

create temporary table made (id uuid);
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ea70000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select public.create_my_company('Newco');
select is((select plan from public.companies where id = (select id from made)), 'free', 'a new company starts on Free');
select is((select (plan_overview() ->> 'seat_limit')::int), 1, 'with one seat, taken by its founder');

reset role;
select throws_ok(
  format($$ insert into public.company_members (company_id, user_id, role) values (%L, '5ea70000-0000-4000-8000-000000000002', 'member') $$, (select id from made)),
  '23514', null, 'nobody joins without a seat, however they are added');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ea70000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.change_seats(3) $$, '22023', null, 'Free has no seats to add');
select is(public.change_plan('pro'), 'started', 'the owner starts Pro');
select is(public.change_seats(3), 3, 'and gives it three seats');
select is((select (plan_overview() -> 'meters' -> 0 ->> 'limit')::int), 75, 'each seat brings its allowance: three seats, 75 imported calls');
select is((public.take_plan_allowance('calls') ->> 'limit')::int, 75, 'which is what spending checks against');

reset role;
insert into public.company_members (company_id, user_id, role) values ((select id from made), '5ea70000-0000-4000-8000-000000000002', 'member');
insert into public.company_members (company_id, user_id, role) values ((select id from made), '5ea70000-0000-4000-8000-000000000003', 'member');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ea70000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.change_seats(2) $$, '22023', null, 'and cannot have fewer seats than people');

select set_config('request.jwt.claims', '{"sub":"5ea70000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.change_seats(5) $$, '42501', null, 'a member does not change the seats');

select set_config('request.jwt.claims', '{"sub":"5ea70000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.change_plan('incognito'), 'upgraded', 'Pro to Incognito is an upgrade');
select is((select (plan_overview() ->> 'incognito')::boolean), true, 'and Incognito is the plan whose overlay hides');

select public.cancel_plan();
reset role;
update public.subscriptions set period_end = now() - interval '1 minute' where company_id = (select id from made);
select private.roll_subscription((select id from made));
select is((select plan from public.companies where id = (select id from made)), 'free', 'a cancelled plan lands on Free, everyone kept');

select * from finish();
rollback;
