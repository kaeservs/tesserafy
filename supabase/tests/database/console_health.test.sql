-- Account health and weekly activity: operators only, and they report what
-- is there — activity, plan use against limits, failures — and count a view
-- during a support session as nobody's use.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('4ea10001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('4ea10001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('4ea10001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '4ea10001-0000-4000-8000-000000000002', 'owner');

-- A new company: one call this week, opened once by its owner and once in a
-- support session; two calls charged this period; one failure.
insert into public.companies (id, name) values ('4ea10001-0000-4000-8000-0000000000cc', 'Health Co');
insert into public.conversations (id, company_id, title)
values ('4ea10001-0000-4000-8000-0000000000c1', '4ea10001-0000-4000-8000-0000000000cc', 'A call');
insert into public.conversation_views (company_id, conversation_id, user_id, during_support) values
  ('4ea10001-0000-4000-8000-0000000000cc', '4ea10001-0000-4000-8000-0000000000c1', null, false),
  ('4ea10001-0000-4000-8000-0000000000cc', '4ea10001-0000-4000-8000-0000000000c1', null, true);
insert into public.usage_ledger (company_id, meter, amount, period_start)
select '4ea10001-0000-4000-8000-0000000000cc'::uuid, 'calls', 1, s.period_start
  from public.subscriptions s where s.company_id = '4ea10001-0000-4000-8000-0000000000cc'
union all
select '4ea10001-0000-4000-8000-0000000000cc'::uuid, 'calls', 1, s.period_start
  from public.subscriptions s where s.company_id = '4ea10001-0000-4000-8000-0000000000cc';

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"4ea10001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.admin_company_health() $$, '42501', null, 'an owner cannot read account health');
select throws_ok($$ select * from public.admin_activity_weeks() $$, '42501', null, 'or weekly activity');

select set_config('request.jwt.claims',
  '{"sub":"4ea10001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select calls_7d || '/' || calls_30d || ' views ' || views_7d
     from public.admin_company_health() where company_id = '4ea10001-0000-4000-8000-0000000000cc'),
  '1/1 views 1',
  'calls this week and month, and views — not counting the support session'
);
select ok(
  (select last_call_at is not null and last_view_at is not null
     from public.admin_company_health() where company_id = '4ea10001-0000-4000-8000-0000000000cc'),
  'with when each last happened'
);
select is(
  (select calls_used::integer from public.admin_company_health() where company_id = '4ea10001-0000-4000-8000-0000000000cc'),
  (select count(*)::integer from public.subscriptions where company_id = '4ea10001-0000-4000-8000-0000000000cc') * 2,
  'plan use counts this period''s charges'
);
select is(
  (select count(*)::integer from public.admin_activity_weeks(1) where company_id = '4ea10001-0000-4000-8000-0000000000cc'),
  1,
  'a company that added or opened a call this week is active this week, once'
);
select throws_ok($$ select * from public.admin_activity_weeks(0) $$, '22023', null, 'a number of weeks that means something');

select * from finish();
rollback;
