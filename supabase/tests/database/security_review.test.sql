-- What the security review of 2026-10-04 found in the database stays fixed
-- (20261004110000_security_review): a refund needs the token its spending
-- returned; a meter takes only its own amounts; evidence and lines are
-- written only by whoever may; failures are recorded only for your own
-- company; no support session on an operator; someone who left writes
-- nothing; erasing a call clears that customer's prep briefs; a closed
-- company keeps nothing it taught the AI; preps age out with retention.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email, aud, role) values
  ('5ec00001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('5ec00001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('5ec00001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated'),
  ('5ec00001-0000-4000-8000-000000000004', 'nobody@nowhere.test', 'authenticated', 'authenticated'),
  ('5ec00001-0000-4000-8000-000000000005', 'op1@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('5ec00001-0000-4000-8000-000000000006', 'op2@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-000000000003', 'member');
insert into public.platform_admins (user_id, note) values
  ('5ec00001-0000-4000-8000-000000000005', 'test operator'),
  ('5ec00001-0000-4000-8000-000000000006', 'another test operator');
insert into public.accounts (id, company_id, name)
values ('5ec00001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Acme Robotics');
insert into public.conversations (id, company_id, title, added_by, account_id) values
  ('5ec00001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Imported call',
   '5ec00001-0000-4000-8000-000000000002', '5ec00001-0000-4000-8000-0000000000a1'),
  ('5ec00001-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000b', 'Their call', null, null);
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('5ec00001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-0000000000c1',
        'customer', 0, 4000, 'We have forty thousand set aside for this.');
insert into public.segment_notes (id, company_id, conversation_id, segment_id, author, body)
values ('5ec00001-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-0000000000c1',
        '5ec00001-0000-4000-8000-0000000000d1', '5ec00001-0000-4000-8000-000000000003', 'Good moment.');
insert into public.call_preps (id, company_id, account_id, person_name, created_by, brief) values
  ('5ec00001-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a', '5ec00001-0000-4000-8000-0000000000a1',
   'Dana', '5ec00001-0000-4000-8000-000000000002', '{"about":[],"company":[],"questions":[],"openWith":"Last time you mentioned forty thousand."}');
insert into public.ai_guidance (company_id, feature, kind, body, result, prep_id)
values ('00000000-0000-4000-8000-00000000000a', 'prep', 'example', 'Too blunt.', 'Ask about the forty thousand.',
        '5ec00001-0000-4000-8000-0000000000b1');

create temporary table spent (label text, result jsonb);
grant all on spent to authenticated;
-- Every member here has agreed once to tell everyone on the calls they record (ADR 0020).
insert into public.recording_agreements (user_id, email, company_id, terms_version, statement, surface)
select m.user_id, 'test@test.tesserafy.local', m.company_id, 'test', 'I will tell everyone on every call I record.', 'overlay'
  from public.company_members m
on conflict do nothing;

set local role authenticated;

-- 1. A refund needs the token its spending returned.
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into spent select 'call', public.take_plan_allowance('calls');
select ok((select length(result ->> 'refund_token') >= 32 from spent where label = 'call'), 'spending returns a refund token');
select public.refund_plan_allowance((select (result ->> 'ledger_id')::bigint from spent where label = 'call'), 'guessed');
select is(
  (select refunded_at from public.usage_ledger where id = (select (result ->> 'ledger_id')::bigint from spent where label = 'call')),
  null, 'the ledger id alone, readable by any member, refunds nothing'
);
select public.refund_plan_allowance((select (result ->> 'ledger_id')::bigint from spent where label = 'call'),
                                    (select result ->> 'refund_token' from spent where label = 'call'));
select isnt(
  (select refunded_at from public.usage_ledger where id = (select (result ->> 'ledger_id')::bigint from spent where label = 'call')),
  null, 'the token the spending returned does'
);
select throws_ok($$ select public.take_plan_allowance('calls', 25) $$, '22023', null,
  'nobody spends a colleague''s month in one call');
select throws_ok($$ select public.take_plan_allowance('live_seconds', 5000) $$, '22023', null,
  'nor a month of live time');

-- 2. Evidence and lines only from whoever may.
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.record_criterion_events('5ec00001-0000-4000-8000-0000000000c1',
       '[{"segment_id":"5ec00001-0000-4000-8000-0000000000d1","criterion_key":"budget_indicated","kind":"contradiction","quote":"forty thousand","confidence":1,"detector":"t1","model":"m"}]') $$,
  '42501', null, 'another member cannot write evidence onto someone else''s call'
);
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (public.record_criterion_events('5ec00001-0000-4000-8000-0000000000c1',
     '[{"segment_id":"5ec00001-0000-4000-8000-0000000000d1","criterion_key":"budget_indicated","kind":"evidence","quote":"forty thousand","confidence":0.9,"detector":"t1","model":"m"}]') ->> 'recorded')::integer,
  1, 'whoever added it scores it'
);
select throws_ok(
  $$ select public.append_live_segment('5ec00001-0000-4000-8000-0000000000c1', 'customer', 5000, 6000, 'Budget approved.') $$,
  '42501', null, 'nobody adds lines to an imported transcript, not even whoever imported it'
);
insert into spent select 'live', to_jsonb(public.start_live_conversation('Live call', p_consent_statement => 'Everyone agreed.'));
select ok((select captured_live from public.conversations where id = (select (result #>> '{}')::uuid from spent where label = 'live')),
  'a live call is marked as one');
select lives_ok(
  $$ select public.append_live_segment((select (result #>> '{}')::uuid from spent where label = 'live'), 'seller', 0, 2000, 'Hello.') $$,
  'whoever is capturing it adds to it'
);
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.append_live_segment((select (result #>> '{}')::uuid from spent where label = 'live'), 'seller', 0, 2000, 'Hello.') $$,
  '42501', null, 'and nobody else does'
);

-- 3. Failures only for your own company.
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.record_failure('api/x', 'input', 'noise') $$, '42501', null,
  'an account in no company records no failures');
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into spent select 'failure', to_jsonb(public.record_failure('api/x', 'input', 'real', p_conversation_id => '5ec00001-0000-4000-8000-0000000000c2'));
reset role;
select results_eq(
  $$ select company_id, conversation_id from public.system_failures where id = (select (result #>> '{}')::uuid from spent where label = 'failure') $$,
  $$ values ('00000000-0000-4000-8000-00000000000a'::uuid, null::uuid) $$,
  'a member''s failure is their own company''s, and another company''s call is not named'
);
set local role authenticated;

-- 5. No support session on an operator.
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.open_support_access('5ec00001-0000-4000-8000-000000000006', 'looking into something') $$,
  '22023', null, 'an operator cannot open a session as another operator'
);
select lives_ok(
  $$ select public.open_support_access('5ec00001-0000-4000-8000-000000000002', 'looking into something') $$,
  'but can as a customer'
);

-- 6. Someone who has left writes nothing there.
reset role;
delete from public.company_members where user_id = '5ec00001-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5ec00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.edit_segment_note('5ec00001-0000-4000-8000-0000000000e1', 'Changed after leaving.') $$,
  '42501', null, 'someone removed from the company cannot edit their old note'
);

-- 4. Erasing a call clears that customer's prep briefs, and what they taught.
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.conversations where id = '5ec00001-0000-4000-8000-0000000000c1';
select is((select brief from public.call_preps where id = '5ec00001-0000-4000-8000-0000000000b1'), null,
  'erasing a call clears the brief of a prep for that customer');
select is((select count(*)::int from public.ai_guidance where prep_id = '5ec00001-0000-4000-8000-0000000000b1'), 0,
  'and the lessons taken from it');

-- ...and preps age out with retention.
insert into public.call_preps (id, company_id, person_name, created_at) values
  ('5ec00001-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000b', 'Old prep', now() - interval '100 days'),
  ('5ec00001-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-00000000000b', 'New prep', now());
update public.companies set retention_days = 30 where id = '00000000-0000-4000-8000-00000000000b';
select is((public.purge_expired_conversations('00000000-0000-4000-8000-00000000000b') ->> 'preps')::int, 1,
  'the retention purge takes a prep past the period');
select is((select count(*)::int from public.call_preps where company_id = '00000000-0000-4000-8000-00000000000b'), 1,
  'and leaves a newer one');

-- 7. A closed company keeps nothing it taught the AI.
insert into public.ai_guidance (company_id, feature, kind, body)
values ('00000000-0000-4000-8000-00000000000a', 'action_items', 'instruction', 'Say who owns each step.');
insert into public.scorecard_purposes (company_id, engagement_type, purpose)
values ('00000000-0000-4000-8000-00000000000a', 'discovery', 'sales');
update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from public.ai_guidance where company_id = '00000000-0000-4000-8000-00000000000a')
  + (select count(*)::int from public.scorecard_purposes where company_id = '00000000-0000-4000-8000-00000000000a'),
  0, 'closing a company forgets its instructions and call types'
);

select * from finish();
rollback;
