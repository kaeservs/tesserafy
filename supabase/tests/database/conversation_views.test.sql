-- Who opened which call: recorded as whom, readable by whom, and gone with
-- the call. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('dddd0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('dddd0001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('dddd0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('dddd0001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'dddd0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'dddd0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'dddd0001-0000-4000-8000-000000000003', 'owner');
insert into public.platform_admins (user_id, note) values
  ('dddd0001-0000-4000-8000-000000000004', 'test operator');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ select public.record_conversation_view('00000000-0000-4000-8000-0000000000a1') $$,
  'a member opening a call is recorded'
);
select public.record_conversation_view('00000000-0000-4000-8000-0000000000a1');

select throws_ok(
  $$ select public.record_conversation_view('00000000-0000-4000-8000-0000000000b1') $$,
  '42501', null,
  'nobody records a visit to another company''s call'
);

select is(
  (select count(*)::integer from public.conversation_views),
  0,
  'and a member cannot read the log, even their own visits'
);

-- ---------------------------------------------------------------------------
-- A visit during a support session
-- ---------------------------------------------------------------------------
reset role;
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at)
values ('dddd0001-0000-4000-8000-000000000004', 'dddd0001-0000-4000-8000-000000000001',
        'blank scorecard, ticket 7', now() + interval '30 minutes');
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.record_conversation_view('00000000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------------------
-- Reading, as the owner
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.conversation_views),
  2,
  'the owner reads the log, and the member''s second visit within ten minutes was not a second row'
);

select is(
  (select email from public.conversation_viewers('00000000-0000-4000-8000-0000000000a1')
    where not during_support),
  'member@acme.test',
  'the member''s visit, by address'
);

select is(
  (select email from public.conversation_viewers('00000000-0000-4000-8000-0000000000a1')
    where during_support),
  'owner@acme.test',
  'and a visit while a support session was open is marked as possibly staff'
);

select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.conversation_viewers('00000000-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'a member cannot ask who opened a call'
);

select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.conversation_viewers('00000000-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'nor can another company''s owner'
);
select is(
  (select count(*)::integer from public.conversation_views),
  0,
  'who sees none of the rows either'
);

select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.conversation_views),
  2,
  'a platform admin reads all of them'
);

-- ---------------------------------------------------------------------------
-- Gone with the call
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"dddd0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.erase_conversation('00000000-0000-4000-8000-0000000000a1') $$,
  'the owner erases the call'
);

reset role;
select is(
  (select count(*)::integer from public.conversation_views
    where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  0,
  'and who opened it goes with it'
);

select * from finish();
rollback;
