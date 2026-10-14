-- Fixes from reading the whole project through (2026-10-14). Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- 1. Only the extractor's runs count as extraction ------------------------------

insert into auth.users (id, email, aud, role)
values ('a7a7a7a7-0000-4000-8000-000000000001', 'reader@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', 'a7a7a7a7-0000-4000-8000-000000000001');

-- Action items and a follow-up drafted on the call: T3, and not extraction.
insert into public.model_usage (company_id, conversation_id, tier, model, detector, duration_ms) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   't3', 'claude-sonnet-5', 't3-actions@2026-09-30', 1000),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   't3', 'claude-sonnet-5', 't3-follow-up@2026-10-12', 1000);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select extraction_runs from public.conversation_pipeline()
    where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  0,
  'drafting action items or a follow-up is not an extraction run'
);

reset role;
insert into public.model_usage (company_id, conversation_id, tier, model, detector, duration_ms) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   't3', 'claude-sonnet-5', 't3-extract@2026-09-19', 1000),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   't3', 'claude-opus-5', 't3-extract@2026-09-17', 1000);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select extraction_runs from public.conversation_pipeline()
    where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  2,
  'every version of the extractor counts'
);

reset role;
insert into public.model_usage (company_id, conversation_id, tier, model, detector, duration_ms) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   't3', 'claude-opus-5', null, 1000);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select extraction_runs from public.conversation_pipeline()
    where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  3,
  'a run from before detectors were recorded still counts'
);

reset role;

-- 2. One row across tenants raises the alarm at once ---------------------------

insert into private.ops_tokens (token_hash, hint)
values (sha256(convert_to('ops_read_through_test', 'UTF8')), 'test');

select lives_ok(
  $$ insert into public.system_failures (source, kind, message)
     values ('api/ask', 'tenant_boundary', 'retrieve() got a row from another company') $$,
  'a row from another company is a kind of failure of its own'
);

-- Two open requests to add someone; one company is then closed.
insert into public.access_requests (company_id, email, role) values
  ('00000000-0000-4000-8000-00000000000a', 'new-a@acme.test', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'new-b@globex.test', 'member');
update public.companies
   set closed_at = now(), closed_reason = 'test'
 where id = '00000000-0000-4000-8000-00000000000b';

create temporary table digest (d jsonb);
grant all on digest to anon;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into digest select public.ops_digest('ops_read_through_test', 1);

select is((select (d ->> 'alarming')::int from digest), 1,
  'the first time is an alarm, where any other kind waits for a second');
select is((select (d -> 'waiting' ->> 'access_requests')::int from digest), 1,
  'a closed company''s request is not waiting on anyone');

reset role;

-- 3. The console's health page counts seats --------------------------------------

insert into auth.users (id, email, aud, role)
values ('a7a7a7a7-0000-4000-8000-000000000002', 'operator@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note)
values ('a7a7a7a7-0000-4000-8000-000000000002', 'test operator');
update public.companies set plan = 'pro' where id = '00000000-0000-4000-8000-00000000000a';
update public.subscriptions set seats = 5 where company_id = '00000000-0000-4000-8000-00000000000a';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select calls_limit from public.admin_company_health()
    where company_id = '00000000-0000-4000-8000-00000000000a'),
  (select calls * 5 from public.plans where id = 'pro'),
  'five seats of Pro are five seats'' calls, not one'
);

reset role;

-- 4. A session can ask whether it is a support visit ------------------------------

insert into auth.users (id, email, aud, role) values
  ('a7a7a7a7-0000-4000-8000-000000000003', 'customer@acme.test', 'authenticated', 'authenticated');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('a7a7a7a7-0000-4000-8000-0000000000c1', 'a7a7a7a7-0000-4000-8000-000000000003', now() - interval '60 minutes', now()),
  ('a7a7a7a7-0000-4000-8000-0000000000c2', 'a7a7a7a7-0000-4000-8000-000000000003', now() - interval '20 minutes', now());
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at, created_at)
values ('a7a7a7a7-0000-4000-8000-000000000002', 'a7a7a7a7-0000-4000-8000-000000000003',
        'Investigating a ticket', now() - interval '5 minutes', now() - interval '25 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000003","role":"authenticated","session_id":"a7a7a7a7-0000-4000-8000-0000000000c2"}', true);
select is(public.in_support_session(), true,
  'a session begun inside a support window is one, even after the window closed');
select set_config('request.jwt.claims',
  '{"sub":"a7a7a7a7-0000-4000-8000-000000000003","role":"authenticated","session_id":"a7a7a7a7-0000-4000-8000-0000000000c1"}', true);
select is(public.in_support_session(), false, 'the customer''s own session is not');
reset role;

set local role anon;
select throws_ok($$ select public.in_support_session() $$, '42501', null,
  'and nobody signed out can ask');
reset role;

-- 5. Erasing a call lists the CRM note that carries its quotes -------------------

insert into public.company_crms (company_id, provider, account_ref, token_ciphertext, token_hint)
values ('00000000-0000-4000-8000-00000000000b', 'hubspot', '1234567', 'v1:sealed', 'abcd');
insert into public.crm_logs (company_id, conversation_id, provider, external_id, crm_company_id)
values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'hubspot', '555', '777');

-- As the operator's script erases: no signed-in user.
select set_config('request.jwt.claims', '', true);
select public.erase_conversation('00000000-0000-4000-8000-0000000000b1', 'operator');

select ok(
  (select exported_tickets @> '[{"provider": "hubspot", "note_id": "555", "url": "https://app.hubspot.com/contacts/1234567/record/0-2/777"}]'::jsonb
     from public.erasure_events where conversation_id = '00000000-0000-4000-8000-0000000000b1'),
  'the HubSpot note is listed for a person to delete there'
);
select is((select count(*)::int from public.crm_logs where conversation_id = '00000000-0000-4000-8000-0000000000b1'), 0,
  'and its record here went with the call');

-- 6. Leaving a company takes the calendar there with it ---------------------------

insert into public.calendar_connections (user_id, company_id, provider, account_email, token_ciphertext)
values ('a7a7a7a7-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'google',
        'reader@test.tesserafy.local', 'v1:sealed');
insert into public.calendar_events (user_id, company_id, provider, external_id, title, starts_at, ends_at)
values ('a7a7a7a7-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'google', 'ev-1',
        'Northwind discovery', now() + interval '1 hour', now() + interval '2 hours');

delete from public.company_members
 where company_id = '00000000-0000-4000-8000-00000000000a' and user_id = 'a7a7a7a7-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.calendar_connections where user_id = 'a7a7a7a7-0000-4000-8000-000000000001')
  + (select count(*)::int from public.calendar_events where user_id = 'a7a7a7a7-0000-4000-8000-000000000001'),
  0,
  'the sealed token and the meetings it brought in are gone'
);

select * from finish();
rollback;
