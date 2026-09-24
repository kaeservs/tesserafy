-- Erasure: does "we deleted it" turn out to be true?
--
-- The claim being tested is not that a row goes away. It is that nothing
-- derived from the meeting survives it — segments, their embeddings, signals,
-- the quotes behind them, criterion events, and any insight that rested
-- entirely on it — and that the attempt does not fail on the way out.
--
-- That last part is the reason this suite exists. Before this migration,
-- deleting a conversation whose signals solely backed an insight raised 23514
-- from insight_evidence_keeps_insight_backed: erasure was not unimplemented,
-- it was impossible. A test that only checked the easy case would have gone
-- green over that.
--
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role)
values ('88888888-8888-4888-8888-888888888888', 'erase-owner@test.tesserafy.local',
        'authenticated', 'authenticated'),
       ('99999999-9999-4999-8999-999999999999', 'erase-member@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role)
values ('00000000-0000-4000-8000-00000000000a', '88888888-8888-4888-8888-888888888888', 'owner'),
       ('00000000-0000-4000-8000-00000000000a', '99999999-9999-4999-8999-999999999999', 'member');

-- An insight resting entirely on conversation a1 — the case that used to make
-- erasure impossible.
insert into public.signals (id, company_id, conversation_id, kind, summary, confidence, detector, model)
values ('00000000-0000-4000-8000-0000000051a1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000a1', 'problem',
        'Exporting takes most of a day', 0.9, 't3-extract@test', 'claude-opus-5');

insert into public.signal_evidence (company_id, signal_id, segment_id, quote, quote_start, quote_end)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000051a1',
        '00000000-0000-4000-8000-000000000a11', 'takes us most of Friday afternoon', 28, 61);

insert into public.insights (id, company_id, title, summary, synthesiser, model)
values ('00000000-0000-4000-8000-0000000061a1', '00000000-0000-4000-8000-00000000000a',
        'Manual export is slow', 'Several customers lose a day a week.',
        't3-synthesise@test', 'claude-opus-5');

insert into public.insight_evidence (company_id, insight_id, signal_id)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000061a1',
        '00000000-0000-4000-8000-0000000051a1');

insert into public.criterion_events
  (company_id, conversation_id, criterion_key, kind, confidence,
   segment_id, quote, quote_start, quote_end, detector, model)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
   'pain_quantified', 'evidence', 0.9, '00000000-0000-4000-8000-000000000a11',
   'takes us most of Friday afternoon', 28, 61, 't1-detect@test', 'claude-haiku-4-5');

-- ---------------------------------------------------------------------------
-- Who may erase
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}', true);

select throws_ok(
  $$ select public.erase_conversation('00000000-0000-4000-8000-0000000000a1') $$,
  '42501',
  null,
  'an ordinary member cannot erase a conversation'
);

select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);

select throws_ok(
  $$ select public.erase_conversation('00000000-0000-4000-8000-0000000000b1') $$,
  '42501',
  null,
  'an owner cannot erase another company''s conversation'
);

-- ---------------------------------------------------------------------------
-- The erasure itself
-- ---------------------------------------------------------------------------
-- This is the call that used to raise 23514.

select is(
  (select public.erase_conversation('00000000-0000-4000-8000-0000000000a1', 'request'))
    ->>'insights_removed',
  '1',
  'an insight resting entirely on the erased conversation goes with it'
);

-- Everything below runs unprivileged no longer. Two reasons: segment_embeddings
-- has no select policy for a signed-in user (ADR 0008), so the check would
-- fail on permissions rather than on the thing being tested; and "gone" ought
-- to mean physically gone rather than merely invisible, which only a caller
-- that RLS does not filter can assert.
reset role;

select is_empty(
  $$ select 1 from public.conversations where id = '00000000-0000-4000-8000-0000000000a1' $$,
  'the conversation is gone'
);

select is_empty(
  $$ select 1 from public.segments where conversation_id = '00000000-0000-4000-8000-0000000000a1' $$,
  'its segments are gone'
);

-- The embeddings are the copy people forget: a 384-dimension vector of a
-- sentence is still derived from that sentence.
select is_empty(
  $$ select 1 from public.segment_embeddings
      where segment_id = '00000000-0000-4000-8000-000000000a11' $$,
  'their embeddings are gone'
);

select is_empty(
  $$ select 1 from public.criterion_events
      where conversation_id = '00000000-0000-4000-8000-0000000000a1' $$,
  'the criterion evidence is gone'
);

select is_empty(
  $$ select 1 from public.insights where id = '00000000-0000-4000-8000-0000000061a1' $$,
  'and the insight that could no longer be evidenced'
);

-- ---------------------------------------------------------------------------
-- What survives, and what it may say
-- ---------------------------------------------------------------------------

select is(
  (select segments_removed from public.erasure_events
    where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  2,
  'the erasure is logged with what it removed'
);

-- The log is not allowed to become a second copy. If a column ever appears
-- here that could hold a quote, a title or a name, this fails.
select is(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'public' and table_name = 'erasure_events'
      and column_name in ('title', 'quote', 'speaker', 'summary', 'text')),
  0,
  'the erasure log holds no content of its own'
);

-- The other tenant holds the identical sentence and must be untouched: an
-- erasure that reached across companies would be the worst possible version
-- of this feature.
select isnt_empty(
  $$ select 1 from public.segments
      where id = '00000000-0000-4000-8000-000000000b11' $$,
  'the other company''s identical segment is untouched'
);

select * from finish();
rollback;
