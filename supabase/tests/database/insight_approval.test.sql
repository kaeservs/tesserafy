-- P8: nothing is created without a person, and nobody decides for another
-- company. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- A member of company A, and an outsider who belongs to company B.
insert into auth.users (id, email, aud, role) values
  ('33333333-3333-4333-8333-333333333333', 'member-a@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'member-b@test.tesserafy.local', 'authenticated', 'authenticated');

insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', '33333333-3333-4333-8333-333333333333'),
  ('00000000-0000-4000-8000-00000000000b', '44444444-4444-4444-8444-444444444444');

insert into public.insights (id, company_id, title, summary, synthesiser, model)
values ('00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-00000000000a',
        'Manual re-keying costs hours', 'Several customers describe the same routine.',
        't3-synthesise@test', 'claude-opus-5');

insert into public.insight_evidence (company_id, insight_id, signal_id)
values ('00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-000000000a21');

-- Still the owner here: the fixture above was just inserted.
select is(
  (select status from public.insights where id = '00000000-0000-4000-8000-0000000000f1'),
  'proposed',
  'an insight is written as proposed'
);

-- From here on everything runs as a signed-in user. The membership check in
-- these functions comes first and reads auth.uid(), so asserting the approval
-- rule from an unauthenticated session would only ever prove the membership
-- rule — which is what this test did until CI caught it.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

-- A ticket for an insight nobody approved is the failure this phase is about.
select throws_ok(
  $$ select public.record_insight_ticket(
       '00000000-0000-4000-8000-0000000000f1', 'github', '1', 'https://github.com/x/y/issues/1') $$,
  '23514',
  null,
  'a member cannot record a ticket for an insight nobody approved'
);

-- Decide as the outsider.
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select throws_ok(
  $$ select public.decide_insight('00000000-0000-4000-8000-0000000000f1', 'approved') $$,
  '42501',
  null,
  'a member of another company cannot approve this insight'
);

-- Decide as the member.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select throws_ok(
  $$ select public.decide_insight('00000000-0000-4000-8000-0000000000f1', 'shipped') $$,
  '22023',
  null,
  'only approved or dismissed are decisions'
);

select lives_ok(
  $$ select public.decide_insight('00000000-0000-4000-8000-0000000000f1', 'approved') $$,
  'a member can approve an insight'
);

select is(
  (select decided_by from public.insights where id = '00000000-0000-4000-8000-0000000000f1'),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'the approver is stamped from the session, not supplied by the caller'
);

select lives_ok(
  $$ select public.record_insight_ticket(
       '00000000-0000-4000-8000-0000000000f1', 'github', '7', 'https://github.com/x/y/issues/7') $$,
  'an approved insight can have its ticket recorded'
);

-- Clicking twice must not open two tickets.
select throws_ok(
  $$ select public.record_insight_ticket(
       '00000000-0000-4000-8000-0000000000f1', 'github', '8', 'https://github.com/x/y/issues/8') $$,
  '23505',
  null,
  'one ticket per insight per provider'
);

select is(
  (select created_by from public.insight_tickets
   where insight_id = '00000000-0000-4000-8000-0000000000f1'),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'the ticket records who raised it'
);

reset role;

select * from finish();
rollback;
