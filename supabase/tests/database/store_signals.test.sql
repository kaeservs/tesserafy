-- store_signals(): one transaction per conversation's findings, and the
-- evidence rules the database enforces on them.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- The seeded fixture already holds a signal for company A, so these tests
-- count only what they write themselves.
create temporary table written (id uuid) on commit drop;

select lives_ok(
  $$ insert into written
     select public.store_signals(
       '00000000-0000-4000-8000-00000000000a',
       '00000000-0000-4000-8000-0000000000a1',
       't3-extract@test',
       'claude-opus-5',
       jsonb_build_array(
         jsonb_build_object(
           'kind', 'problem',
           'summary', 'The weekly export costs most of a Friday.',
           'confidence', 0.86,
           'evidence', jsonb_build_array(jsonb_build_object(
             'segment_id', '00000000-0000-4000-8000-000000000a11',
             'quote', 'takes us most of Friday afternoon',
             'quote_start', 28, 'quote_end', 61
           ))
         ),
         jsonb_build_object(
           'kind', 'feature_request',
           'summary', 'Wants the warehouse schedule taken into account.',
           'confidence', 0.6,
           'evidence', jsonb_build_array(jsonb_build_object(
             'segment_id', '00000000-0000-4000-8000-000000000a12',
             'quote', 'warehouse team mostly works nights',
             'quote_start', 4, 'quote_end', 38
           ))
         )
       )
     ) $$,
  'two signals are stored in one call'
);

select is((select count(*)::int from written), 2, 'one id is returned per signal');

-- These tests roll back, so the deferred triggers would never fire on their
-- own. Forcing them here is what catches a trigger that only fails at commit.
select lives_ok(
  'set constraints all immediate',
  'the deferred evidence checks pass for what was just written'
);

select is(
  (select count(*)::int from public.signal_evidence e
   join written w on w.id = e.signal_id),
  2,
  'each signal keeps its evidence'
);

select is(
  (select s.detector from public.signals s join written w on w.id = s.id limit 1),
  't3-extract@test',
  'the detector that produced the signals is recorded'
);

-- A quote that is not what the segment says aborts the whole call.
savepoint bad_quote;
select throws_ok(
  $$ select public.store_signals(
       '00000000-0000-4000-8000-00000000000a',
       '00000000-0000-4000-8000-0000000000a1',
       't3-extract@test', 'claude-opus-5',
       jsonb_build_array(jsonb_build_object(
         'kind', 'problem', 'summary', 'Paraphrased.', 'confidence', 0.9,
         'evidence', jsonb_build_array(jsonb_build_object(
           'segment_id', '00000000-0000-4000-8000-000000000a11',
           'quote', 'eats most of their Friday',
           'quote_start', 28, 'quote_end', 53
         ))
       ))
     ) $$,
  '23514',
  null,
  'a quote that does not match its segment is rejected'
);
rollback to savepoint bad_quote;

select is_empty(
  $$ select 1 from public.signals where summary = 'Paraphrased.' $$,
  'the rejected signal left nothing behind'
);

-- A signal with no evidence is refused before it reaches the deferred check.
savepoint no_evidence;
select throws_ok(
  $$ select public.store_signals(
       '00000000-0000-4000-8000-00000000000a',
       '00000000-0000-4000-8000-0000000000a1',
       't3-extract@test', 'claude-opus-5',
       jsonb_build_array(jsonb_build_object(
         'kind', 'problem', 'summary', 'Unbacked.', 'confidence', 0.9,
         'evidence', jsonb_build_array()
       ))
     ) $$,
  '23514',
  null,
  'a signal with no evidence is rejected'
);
rollback to savepoint no_evidence;

set local role authenticated;
select throws_ok(
  $$ select public.store_signals(
       '00000000-0000-4000-8000-00000000000a',
       '00000000-0000-4000-8000-0000000000a1',
       't3-extract@test', 'claude-opus-5', '[]'::jsonb
     ) $$,
  '42501',
  null,
  'authenticated users cannot execute store_signals'
);
reset role;

select * from finish();
rollback;
