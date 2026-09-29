-- Coaching assignments: owners assign, only the seller marks done, the
-- assigner or an owner withdraws; only the seller, the assigner and owners
-- see one; the seller is notified; and none of it crosses a tenant.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('c0ac0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('c0ac0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('c0ac0001-0000-4000-8000-000000000003', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('c0ac0001-0000-4000-8000-000000000004', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'c0ac0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'c0ac0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'c0ac0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'c0ac0001-0000-4000-8000-000000000004', 'owner');
insert into public.conversations (id, company_id, title, added_by) values
  ('c0ac0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Seller call', 'c0ac0001-0000-4000-8000-000000000002'),
  ('c0ac0001-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000a', 'Other call', 'c0ac0001-0000-4000-8000-000000000003');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  ('c0ac0001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 'c0ac0001-0000-4000-8000-0000000000c1', 'Dana', 0, 4000, 'What budget have you set aside?'),
  ('c0ac0001-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a', 'c0ac0001-0000-4000-8000-0000000000c2', 'Sam', 0, 4000, 'Hello.');

create temporary table made (label text, id uuid);
grant all on made to authenticated;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.assign_coaching('c0ac0001-0000-4000-8000-000000000002', 'c0ac0001-0000-4000-8000-0000000000c1') $$,
  '42501', null, 'a member cannot assign coaching'
);

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.assign_coaching('c0ac0001-0000-4000-8000-000000000004', 'c0ac0001-0000-4000-8000-0000000000c1') $$,
  '22023', null, 'nor can anyone be assigned outside the company'
);
select throws_ok(
  $$ select public.assign_coaching('c0ac0001-0000-4000-8000-000000000002', 'c0ac0001-0000-4000-8000-0000000000c1',
       'c0ac0001-0000-4000-8000-0000000000d2') $$,
  '22023', null, 'and a moment must be in the call'
);
insert into made select 'a', public.assign_coaching('c0ac0001-0000-4000-8000-000000000002', 'c0ac0001-0000-4000-8000-0000000000c1',
  'c0ac0001-0000-4000-8000-0000000000d1', 'Hear how the budget question lands.');
select ok((select id from made where label = 'a') is not null, 'an owner assigns a moment with a note');

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.notifications where kind = 'coaching_assigned'), 1, 'the seller is notified');
select is((select note from public.coaching_assignments), 'Hear how the budget question lands.', 'and reads it');

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.coaching_assignments), 0, 'a colleague does not see it');
select throws_ok(
  $$ select public.complete_coaching((select id from made where label = 'a')) $$,
  '42501', null, 'nor mark it done'
);

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.coaching_assignments), 0, 'another company does not see it');

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.complete_coaching((select id from made where label = 'a'), 'Heard it. Will lead with it.') $$,
  'the seller marks it done');
select throws_ok($$ select public.withdraw_coaching((select id from made where label = 'a')) $$, '42501', null,
  'but cannot withdraw it');

select set_config('request.jwt.claims', '{"sub":"c0ac0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select status, reply from public.coaching_assignments $$,
  $$ values ('done'::text, 'Heard it. Will lead with it.'::text) $$,
  'the owner sees it done, with the reply'
);
select lives_ok($$ select public.withdraw_coaching((select id from made where label = 'a')) $$, 'and can withdraw it');

reset role;
select is((select count(*)::int from public.notifications where kind = 'coaching_assigned'), 0,
  'withdrawing it takes its notification with it');

select * from finish();
rollback;
