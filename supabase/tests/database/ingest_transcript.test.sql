-- ingest_transcript(): the atomicity and permission claims ADR 0008 makes.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- A well-formed call: one conversation, two segments, two vectors.
select lives_ok(
  $$ select public.ingest_transcript(
       '00000000-0000-4000-8000-00000000000a',
       'Acme — ingested call',
       '2026-09-03T10:00:00Z',
       'fixture',
       jsonb_build_array(
         jsonb_build_object(
           'id', '00000000-0000-4000-8000-00000000c001',
           'speaker', 'customer', 'start_ms', 0, 'end_ms', 2000,
           'text', 'We export it every Friday.',
           'embedding', (select jsonb_agg(1) from generate_series(1, 384))
         ),
         jsonb_build_object(
           'id', '00000000-0000-4000-8000-00000000c002',
           'speaker', null, 'start_ms', 2000, 'end_ms', 4000,
           'text', 'By hand, yes.',
           'embedding', (select jsonb_agg(0) from generate_series(1, 384))
         )
       )
     ) $$,
  'a well-formed transcript is ingested'
);

select is(
  (select count(*)::int from public.segments
   where id in ('00000000-0000-4000-8000-00000000c001',
                '00000000-0000-4000-8000-00000000c002')),
  2,
  'both segments are written, under the ids the caller chose'
);

select is(
  (select count(*)::int from public.segment_embeddings
   where segment_id in ('00000000-0000-4000-8000-00000000c001',
                        '00000000-0000-4000-8000-00000000c002')),
  2,
  'both embeddings are written'
);

select is(
  (select s.speaker from public.segments s
   where s.id = '00000000-0000-4000-8000-00000000c002'),
  null,
  'a null speaker survives the round trip through jsonb'
);

-- Atomicity: the second segment carries a 767-wide vector, so the embedding
-- insert fails after the conversation and both segments have been written.
savepoint before_bad_ingest;
select throws_ok(
  $$ select public.ingest_transcript(
       '00000000-0000-4000-8000-00000000000a',
       'Acme — doomed call',
       null,
       'fixture',
       jsonb_build_array(
         jsonb_build_object(
           'id', '00000000-0000-4000-8000-00000000d001',
           'speaker', 'customer', 'start_ms', 0, 'end_ms', 1000,
           'text', 'This should not survive.',
           'embedding', (select jsonb_agg(1) from generate_series(1, 767))
         )
       )
     ) $$,
  null,
  'a wrong-width vector aborts the ingest'
);
rollback to savepoint before_bad_ingest;

select is_empty(
  $$ select 1 from public.conversations where title = 'Acme — doomed call' $$,
  'a failed ingest leaves no conversation behind'
);

-- Permissions: ingest is service-role work, like match_segments.
set local role authenticated;
select throws_ok(
  $$ select public.ingest_transcript(
       '00000000-0000-4000-8000-00000000000a', 'Planted', null, 'fixture',
       jsonb_build_array(jsonb_build_object(
         'id', '00000000-0000-4000-8000-00000000e001',
         'speaker', null, 'start_ms', 0, 'end_ms', 1, 'text', 'x',
         'embedding', (select jsonb_agg(1) from generate_series(1, 384))
       ))
     ) $$,
  '42501',
  null,
  'authenticated users cannot execute ingest_transcript'
);
reset role;

select * from finish();
rollback;
