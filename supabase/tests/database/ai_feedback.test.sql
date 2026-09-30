-- "Not right" on what the AI wrote: an action item, a signal or a point in a
-- prep is removed and becomes an example with its reason; only whoever added
-- the call (or wrote the prep), or an owner, may say so; the example goes
-- when its call or prep does; a signal an insight rests on alone stays; a
-- prep's brief is changed only by its author or an owner; and none of it
-- crosses a tenant.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, email, aud, role) values
  ('fb000001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('fb000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('fb000001-0000-4000-8000-000000000003', 'rival@globex.test', 'authenticated', 'authenticated'),
  ('fb000001-0000-4000-8000-000000000004', 'other@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-000000000004', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'fb000001-0000-4000-8000-000000000003', 'owner');
insert into public.conversations (id, company_id, title, added_by)
values ('fb000001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Call', 'fb000001-0000-4000-8000-000000000002');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  ('fb000001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000c1',
   'seller', 0, 4000, 'Great talking to you, have a good weekend.'),
  ('fb000001-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000c1',
   'customer', 4000, 8000, 'Exports take us two days every month.');
insert into public.action_items (id, company_id, conversation_id, segment_id, quote, action, owner_side, detector, model) values
  ('fb000001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000c1',
   'fb000001-0000-4000-8000-0000000000d1', 'have a good weekend', 'Have a good weekend', 'ours', 't3-actions', 'm');
-- Two signals: one on its own, one an insight rests on alone.
insert into public.signals (id, company_id, conversation_id, kind, summary, confidence, detector, model) values
  ('fb000001-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000c1',
   'feature_request', 'Wants a weekend mode', 0.6, 't3', 'm'),
  ('fb000001-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000c1',
   'problem', 'Exports are slow', 0.9, 't3', 'm');
insert into public.signal_evidence (company_id, signal_id, segment_id, quote, quote_start, quote_end) values
  ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000e1', 'fb000001-0000-4000-8000-0000000000d1',
   'have a good weekend', 22, 41),
  ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000e2', 'fb000001-0000-4000-8000-0000000000d2',
   'Exports take us two days', 0, 24);
insert into public.insights (id, company_id, title, summary, synthesiser, model)
values ('fb000001-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', 'Exports', 'Slow exports', 't3', 'm');
insert into public.insight_evidence (company_id, insight_id, signal_id)
values ('00000000-0000-4000-8000-00000000000a', 'fb000001-0000-4000-8000-0000000000f1', 'fb000001-0000-4000-8000-0000000000e2');
insert into public.call_preps (id, company_id, person_name, created_by, brief) values
  ('fb000001-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a', 'Priya Raman', 'fb000001-0000-4000-8000-000000000002',
   '{"about":[{"point":"Priya runs finance.","quote":"Head of Finance","source":{"id":"profile"}},{"point":"Priya likes golf.","quote":"golf","source":{"id":"profile"}}],
     "company":[],"questions":[{"criterionKey":"budget_indicated","ask":"What is the budget?","why":"Budget is still to find out."}],"openWith":null}');

create temporary table made (label text, id uuid);
grant all on made to authenticated;
set local role authenticated;

-- Only whoever added the call, or an owner, says a result on it is not right.
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reject_action_item('fb000001-0000-4000-8000-0000000000a1', 'A pleasantry, not a commitment.') $$,
  '42501', null, 'another member cannot remove a result from someone else''s call'
);
select throws_ok(
  $$ select public.reject_signal('fb000001-0000-4000-8000-0000000000e1', 'Small talk, not a request.') $$,
  '42501', null, 'nor a signal'
);

-- Whoever added it: an action item that is not one.
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reject_action_item('fb000001-0000-4000-8000-0000000000a1', 'no') $$,
  '22023', null, 'a reason is needed'
);
insert into made select 'action', public.reject_action_item('fb000001-0000-4000-8000-0000000000a1', 'A pleasantry, not a commitment.');
select is((select count(*)::int from public.action_items), 0, 'the action item is removed');
select results_eq(
  $$ select feature, kind, body, quote, result, engagement_type from public.ai_guidance where id = (select id from made where label = 'action') $$,
  $$ values ('action_items'::text, 'example'::text, 'A pleasantry, not a commitment.'::text, 'have a good weekend'::text,
             'Have a good weekend'::text, 'discovery'::text) $$,
  'and becomes an example for action items, with its reason, words and what the AI wrote'
);

-- A misread signal.
insert into made select 'signal', public.reject_signal('fb000001-0000-4000-8000-0000000000e1', 'Small talk, not a request.');
select is((select count(*)::int from public.signals where id = 'fb000001-0000-4000-8000-0000000000e1'), 0, 'the signal is removed');
select is((select count(*)::int from public.signal_evidence where signal_id = 'fb000001-0000-4000-8000-0000000000e1'), 0, 'with its evidence');
select results_eq(
  $$ select feature, quote, result from public.ai_guidance where id = (select id from made where label = 'signal') $$,
  $$ values ('insights'::text, 'have a good weekend'::text, 'Request: Wants a weekend mode'::text) $$,
  'and teaches Find insights'
);
select throws_ok(
  $$ select public.reject_signal('fb000001-0000-4000-8000-0000000000e2', 'Not a real problem.') $$,
  '23514', null, 'a signal an insight rests on alone stays'
);

-- A prep: only its author or an owner changes the brief.
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'about', 1, 'Priya likes golf.', 'Irrelevant to the call.') $$,
  '42501', null, 'another member cannot change someone else''s brief'
);
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'about', 0, 'Priya likes golf.', 'Irrelevant to the call.') $$,
  'P0002', null, 'the words must match the item named, so a rewritten brief loses nothing by mistake'
);
select throws_ok(
  $$ select public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'brief', 0, 'x', 'Irrelevant to the call.') $$,
  '22023', null, 'only a part of the brief'
);
insert into made select 'point', public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'about', 1, 'Priya likes golf.', 'Hobbies are not for a sales call.');
select is(
  (select brief -> 'about' from public.call_preps where id = 'fb000001-0000-4000-8000-0000000000b1'),
  '[{"point":"Priya runs finance.","quote":"Head of Finance","source":{"id":"profile"}}]'::jsonb,
  'the point leaves the brief, and the rest stays'
);
insert into made select 'question', public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'questions', 0, 'What is the budget?', 'Too blunt to open with.');
select is(
  (select jsonb_array_length(brief -> 'questions') from public.call_preps where id = 'fb000001-0000-4000-8000-0000000000b1'),
  0, 'a question can go too'
);
select results_eq(
  $$ select quote, result from public.ai_guidance where feature = 'prep' order by created_at, result $$,
  $$ values ('golf'::text, 'Priya likes golf.'::text), (null::text, 'What is the budget?'::text) $$,
  'each becomes an example for call prep; a question has no quote'
);

-- Another company sees none of it, and cannot act on it.
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.ai_guidance), 0, 'another company reads none of it');
select throws_ok(
  $$ select public.reject_signal('fb000001-0000-4000-8000-0000000000e2', 'Not a real problem.') $$,
  'P0002', null, 'nor removes another company''s signal'
);
select throws_ok(
  $$ select public.reject_prep_item('fb000001-0000-4000-8000-0000000000b1', 'about', 0, 'Priya runs finance.', 'Irrelevant here.') $$,
  'P0002', null, 'nor changes another company''s prep'
);

-- Owners see and control every example.
select set_config('request.jwt.claims', '{"sub":"fb000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_ai_guidance((select id from made where label = 'action'), false) $$, 'an owner switches one off');

-- An example goes with its source.
reset role;
delete from public.call_preps where id = 'fb000001-0000-4000-8000-0000000000b1';
select is((select count(*)::int from public.ai_guidance where feature = 'prep'), 0, 'deleting the prep deletes what it taught');
delete from public.conversations where id = 'fb000001-0000-4000-8000-0000000000c1';
select is((select count(*)::int from public.ai_guidance where feature in ('action_items', 'insights')), 0,
  'erasing the call deletes what it taught, words and all');

-- The shape holds whoever writes.
select throws_ok(
  $$ insert into public.ai_guidance (company_id, feature, kind, body, result)
     values ('00000000-0000-4000-8000-00000000000a', 'action_items', 'example', 'why', 'what') $$,
  '23514', null, 'a call''s example names its call'
);
select throws_ok(
  $$ insert into public.ai_guidance (company_id, feature, kind, body, quote)
     values ('00000000-0000-4000-8000-00000000000a', 'scoring', 'example', 'why', 'words') $$,
  '23514', null, 'a scoring example still needs its criterion and whether it counts'
);
select has_index('public', 'ai_guidance', 'ai_guidance_conversation_idx', 'erasing a call finds its examples by index');

select * from finish();
rollback;
