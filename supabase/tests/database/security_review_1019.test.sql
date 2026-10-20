-- The 2026-10-19 security review's database fixes: a support window ends what
-- it started, a support session refuses what only the customer should do, and
-- the smaller bounds. Runs with `supabase test db` (pgTAP). Everything rolls
-- back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- People: Acme's owner and member, five customers whose accounts operators
-- open, an operator, another operator's account, and an account nobody
-- confirmed.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('51900000-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000011', 'ended@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000012', 'unrevoked@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000013', 'expired@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000014', 'second@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000015', 'inside@acme.test', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000021', 'ops@test.tesserafy.local', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000022', 'ops2@test.tesserafy.local', 'authenticated', 'authenticated', now()),
  ('51900000-0000-4000-8000-000000000031', 'squatted@customer.test', 'authenticated', 'authenticated', null);
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '51900000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '51900000-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', '51900000-0000-4000-8000-000000000015', 'owner');
insert into public.platform_admins (user_id, note) values
  ('51900000-0000-4000-8000-000000000021', 'pgTAP operator'),
  ('51900000-0000-4000-8000-000000000022', 'pgTAP second operator');

-- 1. A support window ends what it started ----------------------------------

-- Opened 10 minutes ago for 30; the support session began inside it, and the
-- link the console minted with it is still unused.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, created_at, expires_at) values
  ('51900000-0000-4000-8000-0000000000a1', '51900000-0000-4000-8000-000000000021', '51900000-0000-4000-8000-000000000011',
   'Ticket 1', now() - interval '10 minutes', now() + interval '20 minutes');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b1', '51900000-0000-4000-8000-000000000011', now() - interval '8 minutes', now());
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  ('51900000-0000-4000-8000-0000000000c1', '51900000-0000-4000-8000-000000000011', 'recovery_token', 'pgtap-unused-link', 'ended@acme.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000021","role":"authenticated"}', true);
select isnt(
  (public.end_support_access('51900000-0000-4000-8000-0000000000a1')).revoked_at, null,
  'End now revokes what the window started');
reset role;
select is((select count(*)::integer from auth.one_time_tokens where user_id = '51900000-0000-4000-8000-000000000011'), 0,
  'its unused sign-in link is gone, so it cannot be opened later');
select is((select count(*)::integer from auth.sessions where id = '51900000-0000-4000-8000-0000000000b1'), 0,
  'and the support session is gone with its refresh token');

-- The customer's own sign-in after End now is theirs.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b2', '51900000-0000-4000-8000-000000000011', now() + interval '1 second', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"51900000-0000-4000-8000-000000000011","role":"authenticated","session_id":"51900000-0000-4000-8000-0000000000b2"}', true);
select is(public.in_support_session(), false, 'a sign-in after the window''s link was revoked is the customer''s own');
select is(public.support_session_ended(), false, 'and is not signed out as support');
reset role;

-- A window ended without its sign-ins revoked (as before this migration):
-- a session begun after End now, while the link could still be opened, is
-- taken for the window's, and signed out.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, created_at, expires_at, ended_at) values
  ('51900000-0000-4000-8000-0000000000a2', '51900000-0000-4000-8000-000000000021', '51900000-0000-4000-8000-000000000012',
   'Ticket 2', now() - interval '10 minutes', now() + interval '20 minutes', now() - interval '5 minutes');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b3', '51900000-0000-4000-8000-000000000012', now() - interval '2 minutes', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"51900000-0000-4000-8000-000000000012","role":"authenticated","session_id":"51900000-0000-4000-8000-0000000000b3"}', true);
select is(public.in_support_session(), true, 'a late use of an unrevoked window''s link is a support session');
select is(public.support_session_ended(), true, 'and it is signed out, since the window ended');
reset role;

-- A second window, still open, claims a session begun inside it, even when an
-- earlier window that ended unrevoked spans the same time.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, created_at, expires_at, ended_at) values
  ('51900000-0000-4000-8000-0000000000a4', '51900000-0000-4000-8000-000000000021', '51900000-0000-4000-8000-000000000014',
   'Ticket 4', now() - interval '30 minutes', now() + interval '200 minutes', now() - interval '20 minutes'),
  ('51900000-0000-4000-8000-0000000000a5', '51900000-0000-4000-8000-000000000022', '51900000-0000-4000-8000-000000000014',
   'Ticket 5', now() - interval '10 minutes', now() + interval '20 minutes', null);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b4', '51900000-0000-4000-8000-000000000014', now() - interval '5 minutes', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"51900000-0000-4000-8000-000000000014","role":"authenticated","session_id":"51900000-0000-4000-8000-0000000000b4"}', true);
select is(public.support_session_ended(), false, 'a second support session is not signed out for the first window''s sake');
select is(public.in_support_session(), true, 'and it is a support session');
reset role;

-- A window that ran out, its sign-ins not yet revoked: the sweep revokes them.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, created_at, expires_at) values
  ('51900000-0000-4000-8000-0000000000a3', '51900000-0000-4000-8000-000000000021', '51900000-0000-4000-8000-000000000013',
   'Ticket 3', now() - interval '3 hours', now() - interval '150 minutes');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b5', '51900000-0000-4000-8000-000000000013', now() - interval '170 minutes', now()),
  ('51900000-0000-4000-8000-0000000000b6', '51900000-0000-4000-8000-000000000013', now() - interval '4 hours', now());
select cmp_ok(private.close_support_windows(), '>=', 1, 'the sweep revokes windows that are over');
select isnt((select revoked_at from public.support_access where id = '51900000-0000-4000-8000-0000000000a3'), null,
  'the expired window is revoked');
select is((select count(*)::integer from auth.sessions where id = '51900000-0000-4000-8000-0000000000b5'), 0,
  'and the session begun inside it is gone');
select is((select count(*)::integer from auth.sessions where id = '51900000-0000-4000-8000-0000000000b6'), 1,
  'while the customer''s session from before the window is untouched');
select is(
  (select count(*)::integer from cron.job where jobname = 'close-support-windows' and schedule = '* * * * *'), 1,
  'and the sweep runs every minute');

-- While a window is open, the account's password and email do not change.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, created_at, expires_at) values
  ('51900000-0000-4000-8000-0000000000a6', '51900000-0000-4000-8000-000000000021', '51900000-0000-4000-8000-000000000015',
   'Ticket 6', now() - interval '1 minute', now() + interval '30 minutes');
select throws_ok(
  $$ update auth.users set encrypted_password = 'new' where id = '51900000-0000-4000-8000-000000000015' $$,
  '42501', null, 'a password cannot be set while a support window is open on the account');
select throws_ok(
  $$ update auth.users set email = 'taken@operator.test' where id = '51900000-0000-4000-8000-000000000015' $$,
  '42501', null, 'nor the address changed');
select lives_ok(
  $$ update auth.users set last_sign_in_at = now() where id = '51900000-0000-4000-8000-000000000015' $$,
  'while Auth''s own bookkeeping goes on');

-- 2. A support session refuses what only the customer should do ---------------

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('51900000-0000-4000-8000-0000000000b7', '51900000-0000-4000-8000-000000000015', now() - interval '30 seconds', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"51900000-0000-4000-8000-000000000015","role":"authenticated","session_id":"51900000-0000-4000-8000-0000000000b7"}', true);
select throws_like($$ select public.change_plan('pro') $$, '%support session%', 'change_plan refuses a support session');
select throws_like($$ select public.cancel_plan() $$, '%support session%', 'cancel_plan refuses a support session');
select throws_like($$ select public.set_retention(7) $$, '%support session%', 'set_retention refuses a support session');
select throws_like($$ select public.erase_conversation(gen_random_uuid(), null) $$, '%support session%', 'erase_conversation refuses a support session');
select throws_like($$ select public.connect_tracker('github', 'acme/x', 'v1:a:b:c', 'x') $$, '%support session%', 'connect_tracker refuses a support session');
select throws_like($$ select public.disconnect_tracker() $$, '%support session%', 'disconnect_tracker refuses a support session');
select throws_like($$ select public.record_company_export() $$, '%support session%', 'record_company_export refuses a support session');
select throws_like($$ select public.tracker_for_ticket(gen_random_uuid()) $$, '%support session%', 'tracker_for_ticket refuses a support session');
select throws_like($$ select public.disconnect_crm() $$, '%support session%', 'disconnect_crm refuses a support session');
select throws_like($$ select public.remove_company_member(gen_random_uuid()) $$, '%support session%', 'remove_company_member refuses a support session');
select throws_like($$ select public.set_member_role(gen_random_uuid(), 'member') $$, '%support session%', 'set_member_role refuses a support session');
select throws_like($$ select public.delete_account(gen_random_uuid()) $$, '%support session%', 'delete_account refuses a support session');
select throws_like($$ select public.delete_knowledge_document(gen_random_uuid()) $$, '%support session%', 'delete_knowledge_document refuses a support session');
select throws_like($$ select public.publish_scorecard('pgtap', '[]'::jsonb) $$, '%support session%', 'publish_scorecard refuses a support session');
select throws_like($$ select public.request_account_deletion('inside@acme.test') $$, '%support session%', 'request_account_deletion refuses a support session');
select throws_like($$ select public.set_screen_assist(false) $$, '%support session%', 'set_screen_assist refuses a support session');
select throws_like($$ select public.agree_to_recording('v1', 'I agree.', 'web') $$, '%support session%', 'agree_to_recording refuses a support session');

-- The owner's own session is not refused.
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_retention(400) $$, 'an owner''s own session sets retention as before');
select lives_ok($$ select public.set_retention(null) $$, 'and clears it');

-- 3. Only someone who may change a call writes onto it ------------------------

reset role;
insert into public.conversations (id, company_id, title, added_by) values
  ('51900000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 'The owner''s call', '51900000-0000-4000-8000-000000000001'),
  ('51900000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-00000000000a', 'The member''s call', '51900000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.link_call_to_meeting('51900000-0000-4000-8000-0000000000d1') $$, '42501', null,
  'a member does not put attendees from their calendar on a colleague''s call');
select throws_ok($$ select public.record_segment_embeddings('51900000-0000-4000-8000-0000000000d1', 'gte-small', '[]'::jsonb) $$, '42501', null,
  'nor overwrite its embeddings');
select lives_ok($$ select public.record_segment_embeddings('51900000-0000-4000-8000-0000000000d2', 'gte-small', '[]'::jsonb) $$,
  'and embeds their own call as before');

-- 4. The follow-up email -------------------------------------------------------

reset role;
update public.companies set plan = 'trial' where id = '00000000-0000-4000-8000-00000000000a';
insert into public.follow_ups (company_id, conversation_id, subject, greeting, opening, closing, detector, model)
values ('00000000-0000-4000-8000-00000000000a', '51900000-0000-4000-8000-0000000000d2', 'Next steps', 'Hi', '', '', 't3', 'claude-sonnet-5');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.begin_follow_up_send('51900000-0000-4000-8000-0000000000d2', 'Max', array['dana@customer.test'], 'Next steps', 'Thanks.') $$,
  '0A000', null, 'a company on the trial does not send from Tesserafy');
reset role;
update public.companies set plan = 'pro' where id = '00000000-0000-4000-8000-00000000000a';
insert into public.follow_up_sends (company_id, conversation_id, sent_by, from_name, reply_to, recipients, subject, body, created_at)
select '00000000-0000-4000-8000-00000000000a', '51900000-0000-4000-8000-0000000000d2', '51900000-0000-4000-8000-000000000002',
       'Max', 'member@acme.test', array['dana@customer.test'], 'Next steps', 'Thanks.', now() - interval '2 hours'
  from generate_series(1, 40);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.begin_follow_up_send('51900000-0000-4000-8000-0000000000d2', 'Max', array['dana@customer.test'], 'Next steps', 'Thanks.') $$,
  '54000', null, 'a person sends at most forty a day, however it is asked');

-- 5. Provisioning ----------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000021","role":"authenticated"}', true);
select throws_like(
  $$ select public.open_account_provisioning('ops2@test.tesserafy.local', 'member', '00000000-0000-4000-8000-00000000000b') $$,
  '%operator%', 'an operator''s account is not provisioned into a company');
select throws_like(
  $$ select public.open_account_provisioning('squatted@customer.test', 'member', '00000000-0000-4000-8000-00000000000b') $$,
  '%never confirmed%', 'nor an account nobody confirmed');

-- 6. Imports are bounded however they are asked ----------------------------------

reset role;
create temporary table imported (id uuid);
grant all on imported to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into imported
select public.import_conversation(repeat('t', 1000), '[{"speaker":"Dana","startMs":0,"endMs":1000,"text":"Hello."}]'::jsonb,
                                  p_company_id => '00000000-0000-4000-8000-00000000000a', p_consent_statement => 'Everyone agreed.');
select is((select length(c.title) from public.conversations c join imported i on c.id = i.id), 200,
  'a title is kept to 200 characters');
select throws_ok(
  format($$ select public.import_conversation('Long', '[{"speaker":"Dana","startMs":0,"endMs":1000,"text":"%s"}]'::jsonb,
                                              p_company_id => '00000000-0000-4000-8000-00000000000a', p_consent_statement => 'Everyone agreed.') $$,
         repeat('a', 50001)),
  '22023', null, 'and a line longer than any said is refused');

-- 7. Only an owner dates a call past retention -----------------------------------

reset role;
update public.companies set retention_days = 30 where id = '00000000-0000-4000-8000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.edit_conversation('51900000-0000-4000-8000-0000000000d2', p_occurred_at => now() - interval '60 days') $$,
  '42501', null, 'a member cannot date their call past retention, which would erase it tonight');
select lives_ok(
  $$ select public.edit_conversation('51900000-0000-4000-8000-0000000000d2', p_occurred_at => now() - interval '10 days') $$,
  'but dates it within retention as before');
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.edit_conversation('51900000-0000-4000-8000-0000000000d2', p_occurred_at => now() - interval '60 days') $$,
  'and an owner can');

-- 8 to 10. Smaller bounds -----------------------------------------------------------

reset role;
select is(has_function_privilege('anon', 'public.request_early_access(text, text, text)', 'execute'), false,
  'the unused early-access function is not callable anonymously');
select is(has_function_privilege('authenticated', 'private.may_edit_conversation(uuid, uuid)', 'execute'), false,
  'nor are the private helpers callable by a signed-in user');
create temporary table failure (id uuid);
grant all on failure to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51900000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into failure select public.record_failure('api/assist', 'unknown', 'x', p_model => E'gte-small\n::error title=Fake::alarm');
reset role;
select is((select f.model from public.system_failures f where f.id = (select id from failure)), null,
  'a model that is not a name is not kept, so Health never prints it');
select is((select f.reported_by from public.system_failures f where f.id = (select id from failure)),
  '51900000-0000-4000-8000-000000000002'::uuid, 'and a failure says who recorded it');

select * from finish();
rollback;
