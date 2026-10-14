-- Fixes from reading the whole project through (2026-10-14). Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

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

select * from finish();
rollback;
