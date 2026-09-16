-- P1 evidence guarantees, checked inside Postgres. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.
--
-- Three claims:
--   1. Signals and their evidence obey the same tenant rules as segments.
--   2. A quote must be exactly what its segment says.
--   3. A signal without evidence cannot be committed.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- A user who belongs to company A only.
insert into auth.users (id, email, aud, role)
values ('22222222-2222-4222-8222-222222222222', 'signals-a@test.tesserafy.local',
        'authenticated', 'authenticated');

insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222');


-- ---------------------------------------------------------------------------
-- Structural guarantees, as the owner
-- ---------------------------------------------------------------------------

-- A signal cannot belong to company B while citing company A's conversation.
select throws_ok(
  $$ insert into public.signals
       (company_id, conversation_id, kind, summary, confidence, detector, model)
     values ('00000000-0000-4000-8000-00000000000b',
             '00000000-0000-4000-8000-0000000000a1',
             'problem', 'mis-tagged', 0.9, 'test', 'test') $$,
  '23503',
  null,
  'signal company_id must match its conversation'
);

-- Evidence cannot cross tenants either: company A's signal, company B's segment.
select throws_ok(
  $$ insert into public.signal_evidence
       (company_id, signal_id, segment_id, quote, quote_start, quote_end)
     values ('00000000-0000-4000-8000-00000000000a',
             '00000000-0000-4000-8000-000000000a21',
             '00000000-0000-4000-8000-000000000b11',
             'takes us most of Friday afternoon', 28, 61) $$,
  '23503',
  null,
  'evidence cannot cite a segment from another company'
);

-- A paraphrase is not a quote.
select throws_ok(
  $$ insert into public.signal_evidence
       (company_id, signal_id, segment_id, quote, quote_start, quote_end)
     values ('00000000-0000-4000-8000-00000000000a',
             '00000000-0000-4000-8000-000000000a21',
             '00000000-0000-4000-8000-000000000a12',
             'the warehouse crew work nights', 0, 30) $$,
  '23514',
  null,
  'a quote that does not match its segment is rejected'
);

-- Right text, wrong offsets: still rejected.
select throws_ok(
  $$ insert into public.signal_evidence
       (company_id, signal_id, segment_id, quote, quote_start, quote_end)
     values ('00000000-0000-4000-8000-00000000000a',
             '00000000-0000-4000-8000-000000000a21',
             '00000000-0000-4000-8000-000000000a11',
             'takes us most of Friday afternoon', 0, 33) $$,
  '23514',
  null,
  'a quote at the wrong offsets is rejected'
);

-- The seed row proves the happy path is reachable.
select is(
  (select e.quote
   from public.signal_evidence e
   where e.signal_id = '00000000-0000-4000-8000-000000000a21'),
  'takes us most of Friday afternoon',
  'the seeded evidence quotes its segment exactly'
);

-- A signal with no evidence fails when the deferred constraint is checked.
savepoint no_evidence;
insert into public.signals
  (id, company_id, conversation_id, kind, summary, confidence, detector, model)
values ('00000000-0000-4000-8000-000000000a99',
        '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000a1',
        'problem', 'unbacked claim', 0.9, 'test', 'test');

select throws_ok(
  'set constraints all immediate',
  '23514',
  null,
  'a signal with no evidence cannot be committed'
);
rollback to savepoint no_evidence;

-- Removing the last piece of evidence is the same violation from the other side.
savepoint orphaned;
delete from public.signal_evidence
where signal_id = '00000000-0000-4000-8000-000000000a21';

select throws_ok(
  'set constraints all immediate',
  '23514',
  null,
  'deleting the last evidence row leaves an unbacked signal and is rejected'
);
rollback to savepoint orphaned;


-- ---------------------------------------------------------------------------
-- Tenant isolation, as an authenticated member of company A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

select results_eq(
  'select company_id from public.signals',
  $$ values ('00000000-0000-4000-8000-00000000000a'::uuid) $$,
  'member of A sees only company A signals'
);

select throws_ok(
  $$ insert into public.signals
       (company_id, conversation_id, kind, summary, confidence, detector, model)
     values ('00000000-0000-4000-8000-00000000000a',
             '00000000-0000-4000-8000-0000000000a1',
             'problem', 'planted', 0.9, 'test', 'test') $$,
  '42501',
  null,
  'authenticated users cannot write signals'
);

select * from finish();
rollback;
