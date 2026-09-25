-- Live capture: what a browser is allowed to assert.
--
-- These functions are the first write path in the product a client can reach,
-- so what they refuse matters more than what they accept. The line is that a
-- caller may assert what was said, and may not assert that a quote exists,
-- invent a criterion, borrow another conversation's segment, or write a
-- number.
--
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role)
values ('77777777-7777-4777-8777-777777777777', 'live-a@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '77777777-7777-4777-8777-777777777777');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Starting a call
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.start_live_conversation('Live test call',
       p_consent_statement => 'Everyone agreed.') $$,
  'a member starts a live conversation without naming their company'
);

select throws_ok(
  $$ select public.start_live_conversation('   ') $$,
  '22023',
  null,
  'a call needs a title'
);

select throws_ok(
  $$ select public.start_live_conversation('Someone else''s call', 'discovery', 1,
       '00000000-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'nobody starts a call in another company'
);

-- Keep the conversation and a segment to hang the rest of the tests off.
create temporary table fixture as
  select public.start_live_conversation('Evidence test call',
    p_consent_statement => 'Everyone agreed.') as conversation_id;

create temporary table seg as
  select public.append_live_segment(
    (select conversation_id from fixture),
    'customer', 61000, 68000,
    'Exporting the weekly report takes us most of Friday afternoon.'
  ) as segment_id;

select isnt_empty(
  $$ select 1 from public.segments where id = (select segment_id from seg) $$,
  'an utterance is appended to the call'
);

-- ---------------------------------------------------------------------------
-- Evidence: derived, not accepted
-- ---------------------------------------------------------------------------

select is(
  (select public.record_criterion_events(
     (select conversation_id from fixture),
     jsonb_build_array(jsonb_build_object(
       'criterion_key', 'pain_quantified',
       'kind', 'evidence',
       'confidence', 0.9,
       'segment_id', (select segment_id from seg),
       'quote', 'takes us most of Friday afternoon',
       'detector', 't1-detect@test',
       'model', 'claude-haiku-4-5'
     ))))->>'recorded',
  '1',
  'evidence quoting the segment verbatim is recorded'
);

-- The offsets were never sent. They are found in the stored text, which is
-- the whole reason a client cannot fabricate a citation.
select is(
  (select quote_start || '-' || quote_end from public.criterion_events
    where segment_id = (select segment_id from seg)),
  '28-61',
  'the offsets are derived from the segment, not taken from the caller'
);

select is(
  (select public.record_criterion_events(
     (select conversation_id from fixture),
     jsonb_build_array(jsonb_build_object(
       'criterion_key', 'pain_quantified',
       'kind', 'evidence',
       'confidence', 0.9,
       'segment_id', (select segment_id from seg),
       'quote', 'takes them all of Friday',
       'detector', 't1-detect@test',
       'model', 'claude-haiku-4-5'
     ))))->>'rejected',
  '1',
  'a paraphrase is rejected, because it is not in the segment'
);

select is(
  (select public.record_criterion_events(
     (select conversation_id from fixture),
     jsonb_build_array(jsonb_build_object(
       'criterion_key', 'invented_criterion',
       'kind', 'evidence',
       'confidence', 0.9,
       'segment_id', (select segment_id from seg),
       'quote', 'takes us most of Friday afternoon',
       'detector', 't1-detect@test',
       'model', 'claude-haiku-4-5'
     ))))->>'rejected',
  '1',
  'a criterion the conversation is not scored against is rejected'
);

-- Segment b11 belongs to the other tenant's conversation. Both tenants hold
-- the identical sentence, so accepting it could not be passed off as a
-- coincidence of wording.
select is(
  (select public.record_criterion_events(
     (select conversation_id from fixture),
     jsonb_build_array(jsonb_build_object(
       'criterion_key', 'pain_quantified',
       'kind', 'evidence',
       'confidence', 0.9,
       'segment_id', '00000000-0000-4000-8000-000000000b11',
       'quote', 'takes us most of Friday afternoon',
       'detector', 't1-detect@test',
       'model', 'claude-haiku-4-5'
     ))))->>'rejected',
  '1',
  'a segment from another conversation cannot back this one''s evidence'
);

select throws_ok(
  $$ select public.record_criterion_events('00000000-0000-4000-8000-0000000000b1',
       jsonb_build_array()) $$,
  '42501',
  null,
  'nobody records evidence against another company''s conversation'
);

-- Repeats are the normal case: windows overlap, so the same span is observed
-- two or three times per call.
select is(
  (select public.record_criterion_events(
     (select conversation_id from fixture),
     jsonb_build_array(jsonb_build_object(
       'criterion_key', 'pain_quantified',
       'kind', 'evidence',
       'confidence', 0.95,
       'segment_id', (select segment_id from seg),
       'quote', 'takes us most of Friday afternoon',
       'detector', 't1-detect@test',
       'model', 'claude-haiku-4-5'
     ))))->>'recorded',
  '0',
  'the same span observed again is not recorded twice'
);

reset role;

select * from finish();
rollback;
