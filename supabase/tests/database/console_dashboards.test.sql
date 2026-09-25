-- The console's overview and company detail: operators only, and counting
-- what is there. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role, last_sign_in_at) values
  ('aeae0001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated', now()),
  ('aeae0001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated', now()),
  ('aeae0001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated', null);
insert into public.platform_admins (user_id, note) values
  ('aeae0001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'aeae0001-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'aeae0001-0000-4000-8000-000000000003', 'member');

-- Acme's trial ends in three days; Globex is cancelling.
update public.subscriptions set period_end = now() + interval '3 days'
 where company_id = '00000000-0000-4000-8000-00000000000a';
update public.companies set plan = 'basic' where id = '00000000-0000-4000-8000-00000000000b';
update public.subscriptions set status = 'active', cancel_at_period_end = true
 where company_id = '00000000-0000-4000-8000-00000000000b';

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"aeae0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_overview() $$, '42501', null,
  'a customer, even an owner, gets no overview of the platform');
select throws_ok(
  $$ select public.admin_company_detail('00000000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nor the detail of their own company through the operator''s door');

select set_config('request.jwt.claims',
  '{"sub":"aeae0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

create temporary table o as select public.admin_overview() as v;

select is(((select v from o) -> 'companies' ->> 'open')::integer,
  (select count(*)::integer from public.companies where closed_at is null),
  'the overview counts open companies');
select is(((select v from o) -> 'companies' -> 'by_plan' ->> 'basic')::integer, 1,
  'by plan');
select is((select v from o) -> 'trials_ending' -> 0 ->> 'name', 'Acme Robotics',
  'lists a trial ending within the week');
select is((select v from o) -> 'changes_pending' -> 0 ->> 'change', 'cancels',
  'and a cancellation waiting for its period to end');
select is(((select v from o) -> 'activity' ->> 'active_7d')::integer >= 2, true,
  'counts people active this week');
select ok((select v from o) ? 'spend' and (select v from o) ? 'failures_24h' and (select v from o) ? 'waiting',
  'and reports spend, failures and what is waiting');

create temporary table d as select public.admin_company_detail('00000000-0000-4000-8000-00000000000a') as v;

select is(jsonb_array_length((select v from d) -> 'members'), 2, 'the detail lists the members');
select is((select v from d) -> 'members' -> 0 ->> 'role', 'owner', 'owners first');
select is(jsonb_array_length((select v from d) -> 'usage'), 4, 'with usage for every meter');
select throws_ok(
  $$ select public.admin_company_detail('99999999-0000-4000-8000-000000000000') $$, '22023', null,
  'and says so for a company that does not exist');

select * from finish();
rollback;
