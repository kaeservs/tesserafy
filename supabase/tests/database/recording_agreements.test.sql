-- The one-time recording agreement (ADR 0020): a live call needs one on file;
-- agreeing is once per Terms version; and the record is read by the person,
-- their company's owners and operators — nobody else. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('a6e00001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('a6e00001-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('a6e00001-0000-4000-8000-000000000003', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('a6e00001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('a6e00001-0000-4000-8000-000000000005', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('a6e00001-0000-4000-8000-000000000006', 'nobody@nowhere.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'a6e00001-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'a6e00001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'a6e00001-0000-4000-8000-000000000003', 'owner'),
  ('00000000-0000-4000-8000-00000000000b', 'a6e00001-0000-4000-8000-000000000004', 'owner');
insert into public.platform_admins (user_id, note) values ('a6e00001-0000-4000-8000-000000000005', 'test operator');

create temporary table agreed (n int, at timestamptz);
grant all on agreed to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.start_live_conversation('A call', p_consent_statement => 'Agreed on file.') $$,
  '22023', 'start_live_conversation: agree once to tell everyone on every call you record',
  'a live call needs its recorder''s agreement on file'
);

insert into agreed select 1, public.agree_to_recording('2026-10-02', 'I will tell everyone on every call I record that it is recorded, and that is my responsibility.', 'overlay');
select ok((select at from agreed where n = 1) is not null, 'a member agrees once');
insert into agreed select 2, public.agree_to_recording('2026-10-02', 'I will tell everyone on every call I record that it is recorded, and that is my responsibility.', 'web');
select is((select at from agreed where n = 2), (select at from agreed where n = 1), 'agreeing again to the same version keeps the first');
select is(
  (select email || ' ' || surface from public.recording_agreements where user_id = 'a6e00001-0000-4000-8000-000000000001'),
  'seller@acme.test overlay',
  'the record keeps who, from their account, and where'
);
select lives_ok(
  $$ select public.start_live_conversation('A call', p_consent_statement => 'Agreed on file.') $$,
  'and then a live call starts'
);

select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.recording_agreements), 0, 'a colleague does not read someone else''s agreement');

select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.recording_agreements), 1, 'the company''s owner does');

select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.recording_agreements), 0, 'another company''s owner does not');

select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.recording_agreements), 1, 'an operator reads every one');

select set_config('request.jwt.claims', '{"sub":"a6e00001-0000-4000-8000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.agree_to_recording('2026-10-02', 'I will tell everyone on every call I record that it is recorded.', 'web') $$,
  '42501', null, 'someone in no company cannot agree for one'
);

-- The record outlives the account: the person is a plain id, not a key.
reset role;
delete from public.company_members where user_id = 'a6e00001-0000-4000-8000-000000000001';
delete from auth.users where id = 'a6e00001-0000-4000-8000-000000000001';
select is((select count(*)::int from public.recording_agreements where email = 'seller@acme.test'), 1,
  'deleting the account keeps the agreement it made');

select * from finish();
rollback;
