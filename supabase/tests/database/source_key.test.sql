-- Importing the same transcript twice. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create function pg_temp.ingest(p_source_key text) returns uuid
language sql as $fn$
  select public.ingest_transcript(
    '00000000-0000-4000-8000-00000000000a',
    'Imported call',
    null,
    'fixture',
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'speaker', 'customer', 'start_ms', 0, 'end_ms', 1000,
      'text', 'We export the report by hand every Friday.',
      'embedding', (select jsonb_agg(1) from generate_series(1, 384))
    )),
    p_source_key
  );
$fn$;

select lives_ok(
  $$ select pg_temp.ingest('calls/2026-09/acme.vtt') $$,
  'a transcript imports with a source key'
);

select is(
  (select source_key from public.conversations where title = 'Imported call'),
  'calls/2026-09/acme.vtt',
  'the key is recorded on the conversation'
);

-- The whole point: a second run of the same batch must not double the corpus.
select throws_ok(
  $$ select pg_temp.ingest('calls/2026-09/acme.vtt') $$,
  '23505',
  null,
  'the same key cannot be imported twice into one company'
);

select is(
  public.conversation_for_source(
    '00000000-0000-4000-8000-00000000000a', 'calls/2026-09/acme.vtt'
  ),
  (select id from public.conversations where source_key = 'calls/2026-09/acme.vtt'),
  'the importer can find what it already imported'
);

-- Another tenant importing a file of the same name is a different call.
select lives_ok(
  $$ select public.ingest_transcript(
       '00000000-0000-4000-8000-00000000000b',
       'Imported call', null, 'fixture',
       jsonb_build_array(jsonb_build_object(
         'id', gen_random_uuid(),
         'speaker', 'customer', 'start_ms', 0, 'end_ms', 1000,
         'text', 'Same filename, different company.',
         'embedding', (select jsonb_agg(1) from generate_series(1, 384))
       )),
       'calls/2026-09/acme.vtt'
     ) $$,
  'the same key in another company is allowed'
);

-- Conversations created by hand or by the live path carry no key, and any
-- number of them may exist.
select lives_ok(
  $$ select pg_temp.ingest(null), pg_temp.ingest(null) $$,
  'conversations without a source key are not constrained'
);

select * from finish();
rollback;
