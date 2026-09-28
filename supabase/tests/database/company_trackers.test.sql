-- Each company's own tracker: only an owner connects or disconnects it, members
-- see where tickets go but never the ciphertext, the ciphertext leaves only for
-- an approved insight in the caller's own company, and closing forgets it.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email, aud, role) values
  ('7ac40001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('7ac40001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('7ac40001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('7ac40001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('7ac40001-0000-4000-8000-000000000004', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '7ac40001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '7ac40001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '7ac40001-0000-4000-8000-000000000003', 'owner');

insert into public.insights (id, company_id, title, summary, synthesiser, model, status, decided_by, decided_at) values
  ('7ac40001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   'Exports take a day', 'Several customers lose Fridays.', 't3-synthesise@test', 'claude-sonnet-5',
   'approved', '7ac40001-0000-4000-8000-000000000001', now()),
  ('7ac40001-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a',
   'Unreviewed', 'Not decided yet.', 't3-synthesise@test', 'claude-sonnet-5',
   'proposed', null, null);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Connecting
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"7ac40001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.connect_tracker('github', 'acme/product', 'v1:x:y:z', 'abcd') $$,
  '42501', null,
  'a member cannot connect a tracker'
);

select set_config('request.jwt.claims',
  '{"sub":"7ac40001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.connect_tracker('gitlab', 'acme/product', 'v1:x:y:z', 'abcd') $$,
  '23514', null,
  'only a provider the product speaks'
);
select throws_ok(
  $$ select public.connect_tracker('jira', 'jira.internal.example/PROD', 'v1:x:y:z', 'abcd') $$,
  '23514', null,
  'Jira only on an atlassian.net site: the server calls the target, so no other host'
);
select throws_ok(
  $$ select public.connect_tracker('jira', 'acme.atlassian.net/prod', 'v1:x:y:z', 'abcd') $$,
  '23514', null,
  'and a Jira project key in capitals'
);
select throws_ok(
  $$ select public.connect_tracker('linear', 'https://api.linear.app', 'v1:x:y:z', 'abcd') $$,
  '23514', null,
  'a Linear target is a team key and nothing else'
);
select lives_ok(
  $$ select public.connect_tracker('jira', 'acme.atlassian.net/PROD', 'v1:j:k:l', 'wxyz') $$,
  'a Jira Cloud project is accepted'
);
select throws_ok(
  $$ select public.connect_tracker('github', 'not a repository', 'v1:x:y:z', 'abcd') $$,
  '23514', null,
  'a GitHub target is owner/repository'
);
select throws_ok(
  $$ select public.connect_tracker('github', 'acme/product', 'ghp_plaintexttoken', 'oken') $$,
  '23514', null,
  'a token that is not encrypted is refused'
);
select lives_ok(
  $$ select public.connect_tracker('github', 'acme/product', 'v1:iv:tag:data', 'abcd') $$,
  'an owner connects their company''s tracker'
);
select lives_ok(
  $$ select public.connect_tracker('github', 'acme/roadmap', 'v1:iv2:tag2:data2', 'wxyz') $$,
  'and connecting again replaces it'
);
select is(
  (select target from public.company_trackers),
  'acme/roadmap',
  'one tracker per company, the latest'
);

-- ---------------------------------------------------------------------------
-- What a member sees
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"7ac40001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select target || ' ' || token_hint from public.company_trackers),
  'acme/roadmap wxyz',
  'a member sees where tickets go and which token it is'
);
select throws_ok(
  $$ select token_ciphertext from public.company_trackers $$,
  '42501', null,
  'but cannot select the ciphertext'
);

-- ---------------------------------------------------------------------------
-- The one way to the ciphertext
-- ---------------------------------------------------------------------------
select is(
  (select token_ciphertext from public.tracker_for_ticket('7ac40001-0000-4000-8000-0000000000a1')),
  'v1:iv2:tag2:data2',
  'for an approved insight in their own company, the ticket route gets it'
);
select throws_ok(
  $$ select * from public.tracker_for_ticket('7ac40001-0000-4000-8000-0000000000a2') $$,
  '22023', null,
  'not for an insight nobody approved'
);

select set_config('request.jwt.claims',
  '{"sub":"7ac40001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.tracker_for_ticket('7ac40001-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'and never for another company''s insight'
);
select is(
  (select count(*)::integer from public.company_trackers),
  0,
  'another company cannot even see that a tracker exists'
);

-- ---------------------------------------------------------------------------
-- Disconnecting, the log, and closing
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"7ac40001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.disconnect_tracker() $$, 'an owner disconnects it');
select results_eq(
  $$ select action, target from public.tracker_events order by at, action, target $$,
  $$ values ('connected', 'acme.atlassian.net/PROD'), ('connected', 'acme/product'), ('connected', 'acme/roadmap'), ('disconnected', 'acme/roadmap') $$,
  'every connection and disconnection is logged, with where it pointed'
);

select lives_ok(
  $$ select public.connect_tracker('github', 'acme/product', 'v1:iv:tag:data', 'abcd') $$,
  'connected once more'
);

reset role;
select set_config('request.jwt.claims', '', true);
update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::integer from public.company_trackers where company_id = '00000000-0000-4000-8000-00000000000a'),
  0,
  'closing the company forgets its tracker'
);

select * from finish();
rollback;
