-- Action items: stored only with a quote that is in its segment, replaced
-- when found again while what was done stays done, ticked by anyone in the
-- company, and invisible to another. Runs with `supabase test db` (pgTAP).

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, aud, role) values
  ('ac710001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('ac710001-0000-4000-8000-000000000002', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ac710001-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'ac710001-0000-4000-8000-000000000002', 'owner');
insert into public.conversations (id, company_id, title, added_by)
values ('ac710001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Call', 'ac710001-0000-4000-8000-000000000001');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  ('ac710001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 'ac710001-0000-4000-8000-0000000000c1',
   'Maya', 0, 4000, 'I will send the security documents today.'),
  ('ac710001-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a', 'ac710001-0000-4000-8000-0000000000c1',
   'Tom', 4000, 8000, 'Finance will confirm the budget by Friday.');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ac710001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.record_action_items('ac710001-0000-4000-8000-0000000000c1', 't3-actions@test', 'claude-sonnet-5', $$[
    {"segment_id":"ac710001-0000-4000-8000-0000000000d1","quote":"send the security documents today","action":"Send the security documents","owner_side":"ours","owner_name":"Maya","due":"today"},
    {"segment_id":"ac710001-0000-4000-8000-0000000000d2","quote":"confirm the budget by Friday","action":"Confirm the budget","owner_side":"theirs","due":"Friday"},
    {"segment_id":"ac710001-0000-4000-8000-0000000000d2","quote":"words nobody said","action":"Invented","owner_side":"ours"},
    {"segment_id":"ac710001-0000-4000-8000-0000000000d1","quote":"send the security documents today","action":"Anything","owner_side":"somebody"}
  ]$$::jsonb),
  '{"recorded": 2, "rejected": 2}'::jsonb,
  'items are stored only with a quote in their segment and a known side'
);
select results_eq(
  $$ select action, owner_side, due from public.action_items order by action $$,
  $$ values ('Confirm the budget'::text, 'theirs'::text, 'Friday'::text), ('Send the security documents'::text, 'ours'::text, 'today'::text) $$,
  'with whose they are and when they are due, as said'
);

select lives_ok(
  $$ select public.set_action_item_done((select id from public.action_items where owner_side = 'ours'), true) $$,
  'anyone in the company ticks one done'
);
select is((select done_by from public.action_items where owner_side = 'ours'), 'ac710001-0000-4000-8000-000000000001'::uuid, 'recorded as theirs');

-- Found again: the open one is replaced, the done one kept.
select is(
  public.record_action_items('ac710001-0000-4000-8000-0000000000c1', 't3-actions@test', 'claude-sonnet-5', $$[
    {"segment_id":"ac710001-0000-4000-8000-0000000000d2","quote":"Finance will confirm the budget","action":"Finance to confirm the budget","owner_side":"theirs","due":"by Friday"}
  ]$$::jsonb),
  '{"recorded": 1, "rejected": 0}'::jsonb,
  'finding them again records the new reading'
);
select results_eq(
  $$ select action, done from public.action_items order by action $$,
  $$ values ('Finance to confirm the budget'::text, false), ('Send the security documents'::text, true) $$,
  'replacing what was open and keeping what was done'
);
select lives_ok(
  $$ select public.set_action_item_done((select id from public.action_items where owner_side = 'ours'), false) $$,
  'and a tick can be taken back'
);
select is((select done_at from public.action_items where owner_side = 'ours'), null, 'clearing when it was done');

select set_config('request.jwt.claims', '{"sub":"ac710001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.action_items), 0, 'another company sees none of them');
select throws_ok(
  $$ select public.record_action_items('ac710001-0000-4000-8000-0000000000c1', 'x', 'y', '[]'::jsonb) $$,
  'P0002', null, 'nor writes to the call'
);

select * from finish();
rollback;
