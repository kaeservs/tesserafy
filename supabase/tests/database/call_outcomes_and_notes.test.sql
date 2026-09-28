-- A call's outcome, corrections and notes: who may change a call, what is
-- refused, that a scorecard change takes the old evidence with it (and cannot
-- borrow another company's set), and that notes belong to their company, are
-- changed only by their author, and go with the call.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email, aud, role) values
  ('0c0e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('0c0e0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('0c0e0001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated'),
  ('0c0e0001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '0c0e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '0c0e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', '0c0e0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '0c0e0001-0000-4000-8000-000000000004', 'owner');

-- One now() for the whole transaction, so edits order by field.
-- A call the seller added, one moment in it, and one piece of evidence.
insert into public.conversations (id, company_id, title, added_by)
values ('0c0e0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a',
        'zoom_0192.vtt', '0c0e0001-0000-4000-8000-000000000002');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('0c0e0001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a',
        '0c0e0001-0000-4000-8000-0000000000c1', 'customer', 0, 5000,
        'Exporting the weekly report takes us most of Friday.');
insert into public.criterion_events
  (company_id, conversation_id, criterion_key, kind, confidence, segment_id, quote, quote_start, quote_end, detector, model)
values ('00000000-0000-4000-8000-00000000000a', '0c0e0001-0000-4000-8000-0000000000c1', 'pain_quantified',
        'evidence', 0.9, '0c0e0001-0000-4000-8000-0000000000d1', 'most of Friday', 37, 51, 'test', 'test');

-- Each company's own "demo".
insert into public.criteria_definitions (company_id, engagement_type, version, key, label, definition, position) values
  ('00000000-0000-4000-8000-00000000000a', 'demo', 1, 'agenda', 'Agenda', 'They agree what the call covers.', 1),
  ('00000000-0000-4000-8000-00000000000b', 'demo', 1, 'agenda', 'Agenda', 'They agree what the call covers.', 1),
  ('00000000-0000-4000-8000-00000000000b', 'demo', 2, 'agenda', 'Agenda', 'They agree what the call covers.', 1);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Who may change a call
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_title => 'Mine now') $$,
  '42501', null,
  'a member who did not add the call cannot change it'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_title => 'Theirs') $$,
  'P0002', null,
  'another company cannot even find it'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_title => 'Acme — discovery'),
  '{"changed": ["title"], "evidence_removed": 0}'::jsonb,
  'whoever added the call can rename it'
);
select is(
  public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_title => 'Acme — discovery'),
  '{"changed": [], "evidence_removed": 0}'::jsonb,
  'the same title again changes nothing and logs nothing'
);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_title => '   ') $$,
  '22023', null,
  'a call keeps a title'
);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_occurred_at => now() + interval '1 month') $$,
  '22023', null,
  'a call cannot have happened in the future'
);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_outcome => 'maybe') $$,
  '22023', null,
  'an outcome is open, won, lost or unknown'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1',
    p_occurred_at => '2026-09-20T10:00:00Z', p_outcome => 'won'),
  '{"changed": ["occurred_at", "outcome"], "evidence_removed": 0}'::jsonb,
  'an owner dates it and marks it won'
);
select is(
  (select outcome || ' by ' || outcome_set_by from public.conversations where id = '0c0e0001-0000-4000-8000-0000000000c1'),
  'won by 0c0e0001-0000-4000-8000-000000000001',
  'the outcome says who set it'
);

-- ---------------------------------------------------------------------------
-- Changing the scorecard
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1',
       p_engagement_type => 'demo', p_criteria_version => 2) $$,
  '23503', null,
  'not to a version only another company has'
);
select is(
  (select count(*)::integer from public.criterion_events where conversation_id = '0c0e0001-0000-4000-8000-0000000000c1'),
  1,
  'and the refused change removed nothing'
);
select throws_ok(
  $$ select public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1', p_engagement_type => 'demo') $$,
  '22023', null,
  'a scorecard is a name and a version'
);
select is(
  public.edit_conversation('0c0e0001-0000-4000-8000-0000000000c1',
    p_engagement_type => 'demo', p_criteria_version => 1),
  '{"changed": ["scorecard"], "evidence_removed": 1}'::jsonb,
  'to its own company''s set, taking the old evidence with it'
);
select is(
  (select count(*)::integer from public.criterion_events where conversation_id = '0c0e0001-0000-4000-8000-0000000000c1'),
  0,
  'none of the discovery evidence is left to replay against demo'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$ select field, old_value, new_value, evidence_removed from public.conversation_edits order by at, field $$,
  $$ values ('occurred_at'::text, null::text, '2026-09-20 10:00:00+00'::text, 0),
            ('outcome', null, 'won', 0),
            ('scorecard', 'discovery v1', 'demo v1', 1),
            ('title', 'zoom_0192.vtt', 'Acme — discovery', 0) $$,
  'every member reads every change, with what it was before'
);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
create temporary table note as
  select public.add_segment_note('0c0e0001-0000-4000-8000-0000000000d1',
    '  Ask what a Friday costs them in money next time.  ') as id;
select is(
  (select body from public.segment_notes where id = (select id from note)),
  'Ask what a Friday costs them in money next time.',
  'any member notes a moment'
);
select throws_ok(
  $$ select public.add_segment_note('0c0e0001-0000-4000-8000-0000000000d1', '  ') $$,
  '22023', null,
  'a note says something'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.edit_segment_note((select id from note), 'Rewritten') $$,
  '42501', null,
  'another member cannot rewrite it'
);
select throws_ok(
  $$ select public.delete_segment_note((select id from note)) $$,
  '42501', null,
  'or remove it'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.segment_notes),
  0,
  'another company sees none of them'
);
select throws_ok(
  $$ select public.add_segment_note('0c0e0001-0000-4000-8000-0000000000d1', 'hello from outside') $$,
  'P0002', null,
  'nor can it note another company''s moment'
);

select set_config('request.jwt.claims',
  '{"sub":"0c0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.delete_segment_note((select id from note)) $$,
  'an owner may remove any note'
);

select * from finish();
rollback;
