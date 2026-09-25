-- Closing a company: who may, what goes, what stays, and that closed stays
-- closed. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, aud, role) values
  ('cccc0001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('cccc0001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('cccc0001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated'),
  ('cccc0001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('cccc0001-0000-4000-8000-000000000005', 'member@globex.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('cccc0001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'cccc0001-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'cccc0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'cccc0001-0000-4000-8000-000000000004', 'owner'),
  ('00000000-0000-4000-8000-00000000000b', 'cccc0001-0000-4000-8000-000000000005', 'member');

-- What company A has before, and what B has, to compare after.
create temporary table before_counts as
select
  (select count(*)::integer from public.conversations where company_id = '00000000-0000-4000-8000-00000000000a') as a_calls,
  (select count(*)::integer from public.segments where company_id = '00000000-0000-4000-8000-00000000000b') as b_segments;
grant select on before_counts to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Who may
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"cccc0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.close_company('00000000-0000-4000-8000-00000000000a', 'leaving', 'Acme Robotics') $$,
  '42501', null,
  'an owner cannot close their own company'
);

select set_config('request.jwt.claims',
  '{"sub":"cccc0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.close_company('00000000-0000-4000-8000-00000000000a', 'pilot ended', 'Acme') $$,
  '22023', null,
  'the name must be typed exactly'
);
select throws_ok(
  $$ select public.close_company('00000000-0000-4000-8000-00000000000a', '   ', 'Acme Robotics') $$,
  '22023', null,
  'and a reason given'
);

-- ---------------------------------------------------------------------------
-- Closing A
-- ---------------------------------------------------------------------------
create temporary table result as
select public.close_company('00000000-0000-4000-8000-00000000000a', 'pilot ended', 'Acme Robotics') as r;

select is(
  (select (r ->> 'calls_erased')::integer from result),
  (select a_calls from before_counts),
  'every call is erased'
);
select is(
  (select (r ->> 'people_removed')::integer from result),
  2,
  'and everyone is removed'
);

reset role;

select is(
  (select count(*)::integer from public.conversations where company_id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.segments where company_id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.signals where company_id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.segment_embeddings where company_id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.insights where company_id = '00000000-0000-4000-8000-00000000000a'),
  0,
  'nothing of the content is left: calls, segments, signals, vectors, insights'
);

select is(
  (select count(*)::integer from public.erasure_events
    where company_id = '00000000-0000-4000-8000-00000000000a' and reason = 'operator'
      and requested_by = 'cccc0001-0000-4000-8000-000000000001'),
  (select a_calls from before_counts),
  'each call leaves an erasure record naming the operator'
);

select is(
  (select string_agg(email, ',' order by email) from public.membership_removals
    where company_id = '00000000-0000-4000-8000-00000000000a'
      and removed_by = 'cccc0001-0000-4000-8000-000000000001'),
  'member@acme.test,owner@acme.test',
  'each person removed is recorded, by the operator'
);

select ok(
  (select closed_at is not null and closed_reason = 'pilot ended'
          and closed_by = 'cccc0001-0000-4000-8000-000000000001' and name = 'Acme Robotics'
     from public.companies where id = '00000000-0000-4000-8000-00000000000a'),
  'the company stays as a record: closed, by whom, why, and under its name'
);

select is(
  (select count(*)::integer from auth.users where id = 'cccc0001-0000-4000-8000-000000000003'),
  1,
  'login accounts are not deleted'
);

select is(
  (select count(*)::integer from public.segments where company_id = '00000000-0000-4000-8000-00000000000b'),
  (select b_segments from before_counts),
  'another company is untouched'
);

-- ---------------------------------------------------------------------------
-- Closed stays closed
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.company_members (company_id, user_id, role)
     values ('00000000-0000-4000-8000-00000000000a', 'cccc0001-0000-4000-8000-000000000003', 'member') $$,
  '22023', null,
  'nobody can be added to a closed company, by any path'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccc0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.close_company('00000000-0000-4000-8000-00000000000a', 'again', 'Acme Robotics') $$,
  '22023', null,
  'a company is closed once'
);

select ok(
  (select closed_at is not null from public.admin_companies()
    where company_id = '00000000-0000-4000-8000-00000000000a'),
  'the console sees it as closed'
);

-- ---------------------------------------------------------------------------
-- An owner's erasure still works as it did
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"cccc0001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.erase_conversation('00000000-0000-4000-8000-0000000000b1') $$,
  '42501', null,
  'a member still cannot erase a call'
);

select set_config('request.jwt.claims',
  '{"sub":"cccc0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.erase_conversation('00000000-0000-4000-8000-0000000000b1') $$,
  'an owner still can'
);

reset role;
select is(
  (select requested_by from public.erasure_events
    where conversation_id = '00000000-0000-4000-8000-0000000000b1'),
  'cccc0001-0000-4000-8000-000000000004'::uuid,
  'recording the owner who asked, as before'
);

select * from finish();
rollback;
