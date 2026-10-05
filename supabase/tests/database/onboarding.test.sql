-- Onboarding and the plan each person has seen: a new person has neither;
-- finishing the steps records both; a change of plan is then unseen until
-- they are shown it; each person's own, read by nobody else. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, aud, role) values
  ('0b0a0000-0000-4000-8000-000000000001', 'new-owner@acme.test', 'authenticated', 'authenticated'),
  ('0b0a0000-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '0b0a0000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '0b0a0000-0000-4000-8000-000000000002', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b0a0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.user_preferences where onboarded_at is not null), 0, 'someone new has not been onboarded');

select public.finish_onboarding();
select ok((select onboarded_at is not null and plan_seen = (select plan from public.companies where id = '00000000-0000-4000-8000-00000000000a')
             from public.user_preferences), 'finishing records when, and the plan they are on as seen');

reset role;
select private.apply_plan('00000000-0000-4000-8000-00000000000a', 'pro', 'set_by_operator', 'operator', null);
set local role authenticated;
select isnt((select plan_seen from public.user_preferences), 'pro', 'a change of plan is unseen until they are shown it');
select public.mark_plan_seen();
select is((select plan_seen from public.user_preferences), 'pro', 'and seen once shown');

select set_config('request.jwt.claims', '{"sub":"0b0a0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.user_preferences), 0, 'a colleague reads none of it');
select lives_ok($$ select public.mark_plan_seen() $$, 'and keeps their own');

select * from finish();
rollback;
