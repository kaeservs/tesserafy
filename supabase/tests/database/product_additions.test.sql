-- Speakers marked as ours, examples, goals, feedback and cost against price:
-- who may do each, what is refused, and that none of it crosses a tenant.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

insert into auth.users (id, email, aud, role) values
  ('9a0d0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('9a0d0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('9a0d0001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated'),
  ('9a0d0001-0000-4000-8000-000000000004', 'rival@globex.test', 'authenticated', 'authenticated'),
  ('9a0d0001-0000-4000-8000-000000000005', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '9a0d0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '9a0d0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', '9a0d0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '9a0d0001-0000-4000-8000-000000000004', 'owner');
insert into public.platform_admins (user_id, note) values ('9a0d0001-0000-4000-8000-000000000005', 'test operator');

insert into public.conversations (id, company_id, title, added_by, occurred_at) values
  ('9a0d0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Acme call',
   '9a0d0001-0000-4000-8000-000000000002', '2026-09-28T10:00:00Z'),
  ('9a0d0001-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000b', 'Globex call',
   '9a0d0001-0000-4000-8000-000000000004', '2026-09-28T10:00:00Z');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  ('9a0d0001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', '9a0d0001-0000-4000-8000-0000000000c1',
   'Dana Whitfield', 0, 4000, 'What does Friday cost you? Really?!'),
  ('9a0d0001-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a', '9a0d0001-0000-4000-8000-0000000000c1',
   'Priya Raman', 4000, 9000, 'We have forty thousand set aside for this.'),
  ('9a0d0001-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-00000000000b', '9a0d0001-0000-4000-8000-0000000000c2',
   'Someone Else', 0, 1000, 'Hello there.');

create temporary table made (label text, id uuid);
grant all on made to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Speakers marked as ours, and counting who talked
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_our_speaker('  Dana   Whitfield ', true) $$, 'a member marks a speaker as one of theirs');
select lives_ok($$ select public.set_our_speaker('dana whitfield', true) $$, 'and marking the same name again, in any case, is no second row');
select is((select count(*)::int from public.our_speakers), 1, 'one name, stored tidied');
select is((select name from public.our_speakers), 'Dana Whitfield', 'as it was meant');
select throws_ok($$ select public.set_our_speaker('', true) $$, '22023', null, 'a name is needed');
select results_eq(
  $$ select speaker, words, questions from public.conversation_talk('2026-01-01')
     where conversation_id = '9a0d0001-0000-4000-8000-0000000000c1' order by speaker $$,
  $$ values ('Dana Whitfield'::text, 6::bigint, 2::bigint), ('Priya Raman'::text, 8::bigint, 0::bigint) $$,
  'words and questions per speaker, only for calls the caller can read'
);

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.our_speakers), 0, 'another company cannot see them');
select is(
  (select count(*)::int from public.conversation_talk('2026-01-01')
    where conversation_id in ('9a0d0001-0000-4000-8000-0000000000c1', '9a0d0001-0000-4000-8000-0000000000c2')),
  1, 'and counts only its own call'
);

-- ---------------------------------------------------------------------------
-- Examples
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.save_moment('9a0d0001-0000-4000-8000-0000000000d2', 'budget_indicated', null) $$,
  'P0002', null, 'another company cannot save a line of this call'
);

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.save_moment('9a0d0001-0000-4000-8000-0000000000d2', 'not_a_criterion', null) $$,
  '22023', null, 'an example is of a criterion on the call''s scorecard'
);
insert into made select 'moment', public.save_moment('9a0d0001-0000-4000-8000-0000000000d2', 'budget_indicated', 'Straight to the number.');
select is((select count(*)::int from public.moments), 1, 'a member saves a line as an example');
select is(
  public.save_moment('9a0d0001-0000-4000-8000-0000000000d2', 'budget_indicated', null),
  (select id from made where label = 'moment'),
  'saving it again is the same example, note kept'
);
select is((select note from public.moments), 'Straight to the number.', 'the note survives a save without one');

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.moments), 1, 'everyone in the company reads it');
select throws_ok(
  $$ select public.remove_moment((select id from made where label = 'moment')) $$,
  '42501', null, 'a member who did not save it cannot take it out'
);

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.moments), 0, 'another company cannot read it');

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.remove_moment((select id from made where label = 'moment')) $$, 'an owner can');
select is((select count(*)::int from public.moments), 0, 'and it is gone');

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_criterion_goal('discovery', 'budget_indicated', 0.6) $$, '42501', null, 'a member cannot set a goal');

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_criterion_goal('discovery', 'nope', 0.6) $$, '22023', null, 'a goal is for a criterion that exists');
select throws_ok($$ select public.set_criterion_goal('discovery', 'budget_indicated', 1.5) $$, '22023', null, 'and is at most every call');
select lives_ok($$ select public.set_criterion_goal('discovery', 'budget_indicated', 0.6) $$, 'an owner sets one');
select lives_ok($$ select public.set_criterion_goal('discovery', 'budget_indicated', 0.7) $$, 'and moves it');
select is((select target from public.criterion_goals), 0.70::numeric(3, 2), 'one goal, the latest');
select lives_ok($$ select public.set_criterion_goal('discovery', 'budget_indicated', null) $$, 'and clears it');
select is((select count(*)::int from public.criterion_goals), 0, 'gone');

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.send_feedback('   ', '/reports') $$, '22023', null, 'feedback says something');
insert into made select 'feedback', public.send_feedback('The CSV should keep my filters.', '/reports?weeks=4#x');
select is((select page from public.feedback), '/reports', 'it records the page, without the query');

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.feedback), 0, 'a colleague cannot read it');
select throws_ok(
  $$ select public.admin_set_feedback_status((select id from made where label = 'feedback'), 'done') $$,
  '42501', null, 'nor mark it handled'
);

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public.admin_set_feedback_status((select id from made where label = 'feedback'), 'done');
select results_eq(
  $$ select status, handled_by from public.feedback $$,
  $$ values ('done'::text, '9a0d0001-0000-4000-8000-000000000005'::uuid) $$,
  'an operator reads it and marks it done, as themselves'
);

-- ---------------------------------------------------------------------------
-- Cost against price
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.admin_company_margin(30) $$, '42501', null, 'a customer cannot see what anyone costs');

select set_config('request.jwt.claims', '{"sub":"9a0d0001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select ok(
  (select count(*) from public.admin_company_margin(30)) >= 2,
  'an operator sees every company''s cost against its price'
);

-- ---------------------------------------------------------------------------
-- A closed company forgets its people's names
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from public.our_speakers where company_id = '00000000-0000-4000-8000-00000000000a'),
  0, 'closing a company forgets which speakers were its own'
);

select * from finish();
rollback;
