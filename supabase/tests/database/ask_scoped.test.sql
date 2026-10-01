-- Scoped search for "Ask your calls" (ADR 0018): naming calls narrows both
-- searches to just those calls, never widens them past the company or what
-- the caller may read, and not naming any changes nothing. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, aud, role) values
  ('5c0e0001-0000-4000-8000-000000000001', 'member-a@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', '5c0e0001-0000-4000-8000-000000000001');

-- A second call in company A, about the same thing in other words.
insert into public.conversations (id, company_id, title, occurred_at) values
  ('5c0e0001-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'Acme — second call', '2026-09-20T15:00:00Z');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  ('5c0e0001-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-00000000000a',
   '5c0e0001-0000-4000-8000-0000000000a2', 'customer', 1000, 5000, 'Reconciling the numbers eats the whole morning.');
insert into public.segment_embeddings (segment_id, company_id, embedding, model) values
  ('5c0e0001-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-00000000000a',
   array_fill(1::real, array[384])::extensions.vector(384), 'fixture');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select set_eq(
  $$ select segment_id from public.match_segments('00000000-0000-4000-8000-00000000000a',
       array_fill(1::real, array[384])::extensions.vector(384), 10, 0.5) $$,
  $$ values ('00000000-0000-4000-8000-000000000a11'::uuid), ('5c0e0001-0000-4000-8000-000000000a21'::uuid) $$,
  'naming no calls searches all of the company''s'
);
select set_eq(
  $$ select segment_id from public.match_segments('00000000-0000-4000-8000-00000000000a',
       array_fill(1::real, array[384])::extensions.vector(384), 10, 0.5,
       array['5c0e0001-0000-4000-8000-0000000000a2']::uuid[]) $$,
  $$ values ('5c0e0001-0000-4000-8000-000000000a21'::uuid) $$,
  'naming a call searches only its lines'
);
select is(
  (select count(*)::int from public.match_segments('00000000-0000-4000-8000-00000000000a',
     array_fill(1::real, array[384])::extensions.vector(384), 10, 0.5,
     array['00000000-0000-4000-8000-0000000000b1']::uuid[])),
  0,
  'naming another company''s call finds nothing of it'
);
select throws_ok(
  $$ select * from public.match_segments('00000000-0000-4000-8000-00000000000b',
       array_fill(1::real, array[384])::extensions.vector(384), 10, 0,
       array['00000000-0000-4000-8000-0000000000b1']::uuid[]) $$,
  '42501', null, 'and naming calls does not get past the member check'
);
select throws_ok(
  $$ select * from public.match_segments('00000000-0000-4000-8000-00000000000a',
       array_fill(1::real, array[384])::extensions.vector(384), 10, 0,
       (select array_agg(gen_random_uuid()) from generate_series(1, 2001))) $$,
  '22023', null, 'at most 2000 calls at once'
);

select set_eq(
  $$ select segment_id from public.search_segments('Friday') $$,
  $$ values ('00000000-0000-4000-8000-000000000a11'::uuid) $$,
  'word search without calls named is unchanged, and still only the caller''s company'
);
select is_empty(
  $$ select 1 from public.search_segments('Friday', 50, array['5c0e0001-0000-4000-8000-0000000000a2']::uuid[]) $$,
  'word search narrowed to a call without the word finds nothing'
);
select is_empty(
  $$ select 1 from public.search_segments('Friday', 50, array['00000000-0000-4000-8000-0000000000b1']::uuid[]) $$,
  'and naming another company''s call does not reach it'
);

select * from finish();
rollback;
