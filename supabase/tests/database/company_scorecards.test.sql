-- A company's own scorecards (ADR 0016): only an owner publishes, what would
-- score nonsense is refused, a company's sets are its own, and a conversation
-- can neither pin nor collect evidence against another company's set — even
-- one with the same name.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email, aud, role) values
  ('5c0e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('5c0e0001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('5c0e0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('5c0e0001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('5c0e0001-0000-4000-8000-000000000004', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5c0e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '5c0e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '5c0e0001-0000-4000-8000-000000000003', 'owner');

-- Two criteria that pass every check; tests break one at a time.
create temporary table good (criteria jsonb);
insert into good values (jsonb_build_array(
  jsonb_build_object('key', 'agenda_agreed', 'label', 'Agenda agreed',
    'definition', 'The seller and the customer agree what the demo will cover before it starts.'),
  jsonb_build_object('key', 'use_case_shown', 'label', 'Their use case shown', 'weight', 2,
    'definition', 'The seller demonstrates the product against a situation the customer described.')
));
grant select on good to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.publish_scorecard('demo', (select criteria from good)) $$,
  '42501', null,
  'a member cannot publish a scorecard'
);

select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  public.publish_scorecard('demo', (select criteria from good)),
  1,
  'an owner publishes their company''s first version'
);
select is(
  public.publish_scorecard('demo', (select criteria from good) || jsonb_build_array(
    jsonb_build_object('key', 'next_step_booked', 'label', 'Next step booked',
      'definition', 'A dated next meeting or trial is agreed before the call ends.'))),
  2,
  'publishing again makes the next version; the first is untouched'
);
select is(
  (select count(*)::integer from public.criteria_definitions
    where engagement_type = 'demo' and version = 1),
  2,
  'version 1 still has exactly the criteria it was published with'
);
select is(
  (select published_by from public.criteria_definitions
    where engagement_type = 'demo' and version = 2 and key = 'next_step_booked'),
  '5c0e0001-0000-4000-8000-000000000001'::uuid,
  'each row says who published it'
);

select throws_ok(
  $$ select public.publish_scorecard('discovery', (select criteria from good)) $$,
  '22023', null,
  'a template''s name is not available'
);
select throws_ok(
  $$ select public.publish_scorecard('Big Demo!', (select criteria from good)) $$,
  '22023', null,
  'a name is lower-case letters, digits and hyphens'
);
select throws_ok(
  $$ select public.publish_scorecard('demo', (select criteria -> 0 from good) || '[]'::jsonb) $$,
  '22023', null,
  'one criterion is not a scorecard'
);
select throws_ok(
  $$ select public.publish_scorecard('demo', (select criteria || jsonb_build_array(criteria -> 0) from good)) $$,
  '22023', null,
  'two criteria cannot share a key'
);
select throws_ok(
  $$ select public.publish_scorecard('demo', jsonb_build_array(
       jsonb_build_object('key', 'a_thing', 'label', 'A thing', 'definition', 'Too short.'),
       (select criteria -> 1 from good))) $$,
  '22023', null,
  'a definition too short to detect against is refused'
);
select throws_ok(
  $$ select public.publish_scorecard('demo', jsonb_build_array(
       (select criteria -> 0 from good) || '{"weight": 10}'::jsonb,
       (select criteria -> 1 from good))) $$,
  '22023', null,
  'a weight that would swamp the rest is refused'
);
select throws_ok(
  $$ select public.publish_scorecard('demo', jsonb_build_array(
       (select criteria -> 0 from good) || '{"candidate_threshold": 0.9, "confirm_threshold": 0.6}'::jsonb,
       (select criteria -> 1 from good))) $$,
  '22023', null,
  'thresholds out of order are refused'
);

-- ---------------------------------------------------------------------------
-- Whose sets are whose
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.criteria_definitions where engagement_type = 'demo'),
  5,
  'a member reads their company''s sets'
);

select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.criteria_definitions where engagement_type = 'demo'),
  0,
  'another company cannot see them'
);
select is(
  (select count(*)::integer from public.criteria_definitions where engagement_type = 'discovery'),
  5,
  'but everyone reads the templates'
);
select is(
  public.publish_scorecard('demo', jsonb_build_array(
    jsonb_build_object('key', 'budget_named', 'label', 'Budget named',
      'definition', 'The customer says what they have to spend, or who decides it.'),
    jsonb_build_object('key', 'pricing_shown', 'label', 'Pricing shown',
      'definition', 'The seller walks through what the customer would pay and for what.'))),
  1,
  'two companies may each have a scorecard with the same name'
);
select is(
  (select string_agg(key, ',' order by position) from public.criteria_definitions where engagement_type = 'demo'),
  'budget_named,pricing_shown',
  'and each sees only its own'
);

select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(distinct company_id)::integer from public.criteria_definitions where engagement_type = 'demo'),
  2,
  'an operator reads every company''s sets'
);

-- ---------------------------------------------------------------------------
-- Pinning and evidence stay in scope
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.start_live_conversation('Borrowed', 'demo', 2, p_consent_statement => 'Everyone agreed.') $$,
  '23503', null,
  'a call cannot pin a version only another company has'
);

select set_config('request.jwt.claims',
  '{"sub":"5c0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temporary table fixture as
  select public.start_live_conversation('Demo call', 'demo', 2,
    p_consent_statement => 'Everyone agreed.') as conversation_id;
create temporary table seg as
  select public.append_live_segment(
    (select conversation_id from fixture), 'customer', 1000, 6000,
    'We have forty thousand set aside, and I sign off on it.'
  ) as segment_id;
select is(
  public.record_criterion_events(
    (select conversation_id from fixture),
    jsonb_build_array(jsonb_build_object(
      'criterion_key', 'budget_named', 'kind', 'evidence', 'confidence', 0.9,
      'segment_id', (select segment_id from seg),
      'quote', 'We have forty thousand set aside'))),
  '{"recorded": 0, "rejected": 1}'::jsonb,
  'another company''s criterion of the same set name is not evidence here'
);

reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ insert into public.criteria_definitions (engagement_type, version, key, label, definition, position)
     values ('demo', 1, 'x', 'X', 'A template that would shadow two companies.', 1) $$,
  '23505', null,
  'an operator cannot publish a template under a name a company uses'
);
select throws_ok(
  $$ insert into public.criteria_definitions (company_id, engagement_type, version, key, label, definition, position)
     values ('00000000-0000-4000-8000-00000000000a', 'discovery', 9, 'x', 'X', 'A company set named like a template.', 1) $$,
  '23505', null,
  'nor can a company set take a template''s name, by any path'
);

select * from finish();
rollback;
