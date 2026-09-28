-- "This score is wrong": a correction is evidence from a person — anchored to
-- quoted words, made by those who may correct the call, never passed off by
-- a detector, sitting beside the model's own claim, and withdrawn only by its
-- author or an owner.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('d15e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('d15e0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('d15e0001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'd15e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'd15e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'd15e0001-0000-4000-8000-000000000003', 'member');
insert into public.conversations (id, company_id, title, added_by)
values ('d15e0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Seller''s call',
        'd15e0001-0000-4000-8000-000000000002');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('d15e0001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a',
        'd15e0001-0000-4000-8000-0000000000c1', 'customer', 0, 5000,
        'We have forty thousand set aside for this.');
-- The detector half-believed it.
insert into public.criterion_events
  (company_id, conversation_id, criterion_key, kind, confidence, segment_id, quote, quote_start, quote_end, detector, model)
values ('00000000-0000-4000-8000-00000000000a', 'd15e0001-0000-4000-8000-0000000000c1', 'budget_indicated',
        'evidence', 0.6, 'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand set aside', 8, 32, 't1@test', 'haiku');

create temporary table made (id uuid);
grant all on made to authenticated;

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"d15e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'evidence',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand', 'They said the number.') $$,
  '42501', null,
  'a member who did not add the call cannot correct its score'
);

select set_config('request.jwt.claims',
  '{"sub":"d15e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'evidence',
       'd15e0001-0000-4000-8000-0000000000d1', 'fifty thousand', 'They said the number.') $$,
  '22023', null,
  'a correction quotes words that are in the moment'
);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'evidence',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand', '') $$,
  '22023', null,
  'and says why'
);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'made_up_criterion', 'evidence',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand', 'They said the number.') $$,
  '22023', null,
  'about a criterion the call''s scorecard has'
);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'decree',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand', 'They said the number.') $$,
  '22023', null,
  'saying it was met, or that it was not — nothing else'
);

insert into made
select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'evidence',
  'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand set aside', 'They named the budget outright.');
select is(
  (select detector || ' ' || confidence || ' ' || quote_start || '-' || quote_end || ' ' || recorded_by
     from public.criterion_events where id = (select id from made)),
  'person 1 8-32 d15e0001-0000-4000-8000-000000000002',
  'whoever added the call confirms it, on the same words the model half-believed, at full confidence'
);
select is(
  (select count(*)::integer from public.criterion_events where conversation_id = 'd15e0001-0000-4000-8000-0000000000c1'),
  2,
  'and the model''s own claim stays beside the correction'
);
select throws_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'budget_indicated', 'evidence',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand set aside', 'Again.') $$,
  '23505', null,
  'the same correction twice is one'
);
select lives_ok(
  $$ select public.dispute_criterion('d15e0001-0000-4000-8000-0000000000c1', 'pain_quantified', 'contradiction',
       'd15e0001-0000-4000-8000-0000000000d1', 'forty thousand', 'That is their budget, not what the problem costs.') $$,
  '"it wasn''t met" is a contradiction on the claimed words'
);

-- A detector cannot pass its claim off as a person's.
select throws_ok(
  $$ select public.record_criterion_events('d15e0001-0000-4000-8000-0000000000c1', jsonb_build_array(jsonb_build_object(
       'criterion_key', 'timeline_stated', 'kind', 'evidence', 'confidence', 1,
       'segment_id', 'd15e0001-0000-4000-8000-0000000000d1', 'quote', 'set aside',
       'detector', 'person', 'model', 'person'))) $$,
  '23514', null,
  'a detector cannot write a "person" claim without the reason only a person gives'
);

select set_config('request.jwt.claims',
  '{"sub":"d15e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.withdraw_dispute((select id from made)) $$,
  '42501', null,
  'another member cannot withdraw it'
);

select set_config('request.jwt.claims',
  '{"sub":"d15e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.withdraw_dispute(%L) $$,
         (select id from public.criterion_events where detector = 't1@test' limit 1)),
  '42501', null,
  'nor can anyone withdraw the detector''s evidence by hand'
);
select lives_ok($$ select public.withdraw_dispute((select id from made)) $$, 'an owner can withdraw a correction');
select is(
  (select count(*)::integer from public.criterion_events where detector = 'person' and criterion_key = 'budget_indicated'),
  0,
  'and it is gone; the score recomputes from what is left'
);

select * from finish();
rollback;
