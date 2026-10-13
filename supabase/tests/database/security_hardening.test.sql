-- The 2026-10-12 security review's database fixes: what a signed-in member
-- can no longer do to our alerts, our bill, their company's records or the
-- rate limiter. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('5ecd0000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now()),
  ('5ecd0000-0000-4000-8000-000000000002', 'founder@seatco.test', 'authenticated', 'authenticated', now());
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5ecd0000-0000-4000-8000-000000000001', 'member');
insert into public.conversations (id, company_id, title)
values ('5ecd0000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'A call');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('5ecd0000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '5ecd0000-0000-4000-8000-0000000000c1',
        'Dana', 0, 1000, 'We lose a day a week to it.');
update public.app_settings set signup_open = true where id;

create temporary table note (id uuid);
grant all on note to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ecd0000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 1. Alerts and spend ----------------------------------------------------------
select throws_ok(
  $$ select public.record_failure('BILLING: rotate your key at https://evil.example', 'billing', 'x') $$,
  '23514', null, 'a failure''s source is a route name, not a message for the operators');
select lives_ok(
  $$ select public.record_failure('api/assist/knowledge', 'model_unavailable', 'overloaded', p_status => 529) $$,
  'and a real route is recorded as before');
select throws_ok(
  $$ select public.record_model_usage('t3', 'claude-opus-5', 1, 2147483647, 2147483647) $$,
  '23514', null, 'usage no model could have produced is refused');
select lives_ok(
  $$ select public.record_model_usage('t1', 'claude-haiku-5-5', 2214, 36, 79, 862, 0) $$,
  'and a real call''s usage is recorded');

-- 2. The rate limiter ----------------------------------------------------------
select throws_ok(
  $$ select public.take_rate_limit_tokens('api/detect',
       '[{"seconds":1,"limit":9},{"seconds":2,"limit":9},{"seconds":3,"limit":9},{"seconds":4,"limit":9},{"seconds":5,"limit":9}]'::jsonb) $$,
  '22023', null, 'one call writes at most four windows');
select throws_ok(
  $$ select public.take_rate_limit_tokens(repeat('x', 1000), '[{"seconds":60,"limit":9}]'::jsonb) $$,
  '22023', null, 'and a bucket is a short name');
select ok(
  (public.take_rate_limit_tokens('api/detect', '[{"seconds":60,"limit":60},{"seconds":86400,"limit":3000}]'::jsonb) ->> 'allowed')::boolean,
  'a route''s own limits are taken as before');

-- 3. Notes ---------------------------------------------------------------------
insert into note select public.add_segment_note('5ecd0000-0000-4000-8000-0000000000e1', 'They count it weekly.');
reset role;
delete from public.company_members where user_id = '5ecd0000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ecd0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.delete_segment_note((select id from note)) $$,
  '42501', null, 'someone who has left the company no longer deletes their notes there');

-- 4. Seats that nothing pays for -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"5ecd0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.create_my_company('Seatco');
select is(public.change_plan('incognito'), 'started', 'an owner starts Incognito while payments are off');
select throws_ok($$ select public.change_seats(500) $$, '22023', null, 'and cannot give themselves 500 seats for nothing');
select is(public.change_seats(6), 6, 'but has room for five more people than there are');

-- 5. Dates retention cannot reach ----------------------------------------------
reset role;
select throws_ok(
  $$ insert into public.conversations (company_id, title, occurred_at)
     values ('00000000-0000-4000-8000-00000000000a', 'Kept forever', '9999-01-01') $$,
  '23514', null, 'a call cannot be dated far in the future, where retention never reaches');

select * from finish();
rollback;
