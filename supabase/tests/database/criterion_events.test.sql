-- Criterion history: what a past conversation's scorecard is replayed from.
--
-- Three things are being pinned here, all of them invariants the table exists
-- to hold rather than features it offers.
--
--   * the quote must still be what the segment says (invariant 4), enforced
--     by the shared fidelity trigger now that it serves two tables;
--   * a conversation cannot pin a criteria set that does not exist, because a
--     dashboard cannot explain an empty scorecard;
--   * one company's evidence is invisible to another's members (invariant 3
--     at the read path).
--
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, aud, role)
values ('66666666-6666-4666-8666-666666666666', 'criteria-a@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '66666666-6666-4666-8666-666666666666');

-- ---------------------------------------------------------------------------
-- What a conversation is scored against
-- ---------------------------------------------------------------------------

select is(
  (select engagement_type || '/v' || criteria_version
     from public.conversations where id = '00000000-0000-4000-8000-0000000000a1'),
  'discovery/v1',
  'an existing conversation pins the shipped criteria set by default'
);

select throws_ok(
  $$ update public.conversations
       set engagement_type = 'renewal'
     where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '23503',
  null,
  'a conversation cannot pin a criteria set that does not exist'
);

-- ---------------------------------------------------------------------------
-- Evidence, and the quote it rests on
-- ---------------------------------------------------------------------------
-- Segment a11 reads 'Exporting the weekly report takes us most of Friday
-- afternoon.' — offsets 0-29 are 'Exporting the weekly report takes'... which
-- is checked character by character by the trigger, not by this comment.

select lives_ok(
  $$ insert into public.criterion_events
       (company_id, conversation_id, criterion_key, kind, confidence,
        segment_id, quote, quote_start, quote_end, detector, model)
     values
       ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
        'pain_quantified', 'evidence', 0.86,
        '00000000-0000-4000-8000-000000000a11',
        'takes us most of Friday afternoon', 28, 61,
        't1-detect@test', 'claude-haiku-4-5') $$,
  'evidence is recorded when the quote is verbatim'
);

select throws_ok(
  $$ insert into public.criterion_events
       (company_id, conversation_id, criterion_key, kind, confidence,
        segment_id, quote, quote_start, quote_end, detector, model)
     values
       ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
        'pain_quantified', 'evidence', 0.9,
        '00000000-0000-4000-8000-000000000a11',
        'takes them all Friday', 28, 49,
        't1-detect@test', 'claude-haiku-4-5') $$,
  '23514',
  null,
  'a paraphrase is refused, the same as it is for a signal'
);

-- Overlapping windows re-observe the same span. Storing it twice would put the
-- same sentence in the evidence list two or three times for a reader.
select throws_ok(
  $$ insert into public.criterion_events
       (company_id, conversation_id, criterion_key, kind, confidence,
        segment_id, quote, quote_start, quote_end, detector, model)
     values
       ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1',
        'pain_quantified', 'evidence', 0.91,
        '00000000-0000-4000-8000-000000000a11',
        'takes us most of Friday afternoon', 28, 61,
        't1-detect@test', 'claude-haiku-4-5') $$,
  '23505',
  null,
  'the same span for the same criterion is one observation, not two'
);

-- No score column to test: there is none, deliberately. The score is computed
-- on read by packages/scoring, so what is asserted here is that the table
-- stores evidence and nothing that looks like a verdict.
select is(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'public' and table_name = 'criterion_events'
      and column_name in ('score', 'status')),
  0,
  'the table holds no score and no status — both are computed on read'
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

insert into public.criterion_events
  (company_id, conversation_id, criterion_key, kind, confidence,
   segment_id, quote, quote_start, quote_end, detector, model)
values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1',
   'pain_quantified', 'evidence', 0.88,
   '00000000-0000-4000-8000-000000000b11',
   'takes us most of Friday afternoon', 28, 61,
   't1-detect@test', 'claude-haiku-4-5');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);

select isnt_empty(
  $$ select 1 from public.criterion_events
      where company_id = '00000000-0000-4000-8000-00000000000a' $$,
  'a member reads their own company''s evidence'
);

-- Both companies hold the identical quote, so a leak here cannot be mistaken
-- for a coincidence: the row is the same sentence, from the other tenant.
select is_empty(
  $$ select 1 from public.criterion_events
      where company_id = '00000000-0000-4000-8000-00000000000b' $$,
  'and none of another company''s, even for the same words'
);

reset role;

select * from finish();
rollback;
