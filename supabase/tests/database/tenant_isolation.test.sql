-- P0 gate, "via direct query": the same isolation checked inside Postgres,
-- below PostgREST, as the `authenticated` role with a forged JWT subject.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- A user who belongs to company A only.
insert into auth.users (id, email, aud, role)
values ('11111111-1111-4111-8111-111111111111', 'direct-a@test.tesserafy.local',
        'authenticated', 'authenticated');

insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select results_eq(
  'select id from public.companies',
  $$ values ('00000000-0000-4000-8000-00000000000a'::uuid) $$,
  'member of A sees only company A'
);

select is_empty(
  $$ select 1 from public.conversations where company_id <> '00000000-0000-4000-8000-00000000000a' $$,
  'no conversation from another company is visible'
);

select is_empty(
  $$ select 1 from public.segments where company_id <> '00000000-0000-4000-8000-00000000000a' $$,
  'no segment from another company is visible'
);

select isnt_empty(
  $$ select 1 from public.segments $$,
  'own segments are visible (the policy is not simply denying everything)'
);

select throws_ok(
  'select segment_id from public.segment_embeddings',
  '42501',
  null,
  'embeddings are not readable by authenticated users'
);

select throws_ok(
  $$ select * from public.match_segments(
       '00000000-0000-4000-8000-00000000000a',
       array_fill(1::real, array[768])::extensions.vector(768), 10, 0) $$,
  '42501',
  null,
  'authenticated users cannot execute match_segments'
);

select throws_ok(
  $$ insert into public.conversations (company_id, title)
     values ('00000000-0000-4000-8000-00000000000b', 'planted') $$,
  '42501',
  null,
  'cannot write a conversation into company B'
);

-- Structural guard: a segment cannot claim a different company from its
-- conversation, so a correct tenant filter can never be defeated by a
-- mis-tagged row.
reset role;
select throws_ok(
  $$ insert into public.segments (company_id, conversation_id, start_ms, end_ms, text)
     values ('00000000-0000-4000-8000-00000000000b',
             '00000000-0000-4000-8000-0000000000a1', 0, 1000, 'mis-tagged') $$,
  '23503',
  null,
  'segment company_id must match its conversation'
);

select * from finish();
rollback;
