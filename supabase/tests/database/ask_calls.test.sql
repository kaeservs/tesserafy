-- "Ask your calls" has an allowance of its own (ADR 0018): ten on the trial,
-- spent one question at a time, and refused after. Runs with `supabase test
-- db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('a5ca0001-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'a5ca0001-0000-4000-8000-000000000001', 'member');

select is(
  (select array_agg(questions order by rank) from public.plans where id in ('trial', 'basic', 'pro')),
  array[10, 25, 100],
  'the trial, Basic and Pro each allow a number of questions a month'
);
select ok(
  (select questions is null from public.plans where id = 'pilot'),
  'a pilot has no monthly limit'
);

create temporary table spent (n int, result jsonb) on commit drop;
grant all on spent to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a5ca0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into spent select n, public.take_plan_allowance('questions') from generate_series(1, 11) as n;

select is(
  (select count(*)::int from spent where (result ->> 'allowed')::boolean),
  10,
  'a member can ask ten questions on the trial'
);
select is(
  (select result ->> 'allowed' from spent where n = 11),
  'false',
  'and the eleventh is refused'
);
select is(public.plan_has_allowance('questions'), false, 'which the allowance check says before anyone asks');
select throws_ok(
  $$ select public.take_plan_allowance('questions', 2) $$,
  '22023', null, 'a question is spent one at a time'
);
select is(
  (select m ->> 'used' from jsonb_array_elements(public.plan_overview() -> 'meters') m where m ->> 'meter' = 'questions'),
  '10',
  'and the plan overview shows what was used'
);

select * from finish();
rollback;
