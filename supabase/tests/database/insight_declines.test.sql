-- Remembering a group synthesis declined, and who may do it.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- Two signals in company A and one in company B, each cited on a seed
-- segment. The evidence rule is a deferred constraint and this transaction
-- rolls back, so the signals need no evidence rows to exist here.
insert into public.signals (id, company_id, conversation_id, kind, summary, confidence, detector, model)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-0000000000a1', 'feature_request', 'second', 0.8, 'probe', 'probe'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-0000000000a1', 'feature_request', 'first', 0.8, 'probe', 'probe'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b',
   '00000000-0000-4000-8000-0000000000b1', 'feature_request', 'other tenant', 0.8, 'probe', 'probe');

insert into auth.users (id, email, aud, role)
values ('22222222-2222-4222-8222-222222222222', 'declines-a@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-222222222222')::text, true);

-- Given out of order, and with a duplicate: the signature must not care.
select lives_ok(
  $$ select public.record_insight_decline(
       '00000000-0000-4000-8000-00000000000a',
       array['aaaaaaaa-0000-4000-8000-000000000002',
             'aaaaaaaa-0000-4000-8000-000000000001',
             'aaaaaaaa-0000-4000-8000-000000000002']::uuid[],
       'declined', 'probe') $$,
  'a member records a decline for their own company'
);

select is(
  (select signature from public.insight_declines),
  'aaaaaaaa-0000-4000-8000-000000000001,aaaaaaaa-0000-4000-8000-000000000002',
  'the signature is the ids sorted and de-duplicated, as the application builds it'
);

select lives_ok(
  $$ select public.record_insight_decline(
       '00000000-0000-4000-8000-00000000000a',
       array['aaaaaaaa-0000-4000-8000-000000000001',
             'aaaaaaaa-0000-4000-8000-000000000002']::uuid[],
       'declined', 'probe') $$,
  'recording the same group again is not an error'
);

select is(
  (select count(*)::integer from public.insight_declines),
  1,
  'and does not store it twice'
);

select throws_ok(
  $$ select public.record_insight_decline(
       '00000000-0000-4000-8000-00000000000b',
       array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], 'declined', 'probe') $$,
  '42501',
  null,
  'a member cannot record a decline in another company'
);

select throws_ok(
  $$ select public.record_insight_decline(
       '00000000-0000-4000-8000-00000000000a',
       array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], 'declined', 'probe') $$,
  '42501',
  null,
  'nor cite another company''s signal in their own'
);

select * from finish();
rollback;
