-- The console's adoption funnel, weekly spend and operator activity: only an
-- operator reads them, they report what is there, and the signup switch now
-- leaves a record of every change.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('ad0e0001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('ad0e0001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('ad0e0001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ad0e0001-0000-4000-8000-000000000002', 'owner');

-- Acme has a call, an insight and a ticket.
insert into public.conversations (id, company_id, title)
values ('ad0e0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'A call');
insert into public.insights (id, company_id, title, summary, synthesiser, model, status, decided_by, decided_at)
values ('ad0e0001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Exports take a day',
        'Several customers lose Fridays.', 't3@test', 'claude-sonnet-5', 'approved',
        'ad0e0001-0000-4000-8000-000000000002', now());
insert into public.insight_tickets (company_id, insight_id, provider, external_id, url, created_by)
values ('00000000-0000-4000-8000-00000000000a', 'ad0e0001-0000-4000-8000-0000000000a1', 'github', '1',
        'https://github.com/acme/product/issues/1', 'ad0e0001-0000-4000-8000-000000000002');

-- A new company whose only call was erased: it still happened.
insert into public.companies (id, name) values ('ad0e0001-0000-4000-8000-0000000000cc', 'Brand New');
insert into public.erasure_events (company_id, conversation_id, reason)
values ('ad0e0001-0000-4000-8000-0000000000cc', 'ad0e0001-0000-4000-8000-0000000000c9', 'request');

-- A million Haiku input tokens this week: $1 at the published rate.
insert into public.model_usage (company_id, tier, model, detector, input_tokens, output_tokens, duration_ms)
values ('00000000-0000-4000-8000-00000000000a', 't1', 'claude-haiku-4-5', 't1-detect@test', 1000000, 0, 10);

-- The operator opened the owner's account once.
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at)
values ('ad0e0001-0000-4000-8000-000000000001', 'ad0e0001-0000-4000-8000-000000000002',
        'customer asked why a call scored 0', now() + interval '1 hour');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Only an operator
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"ad0e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.admin_adoption() $$, '42501', null, 'an owner cannot read adoption');
select throws_ok($$ select * from public.admin_spend_by_week() $$, '42501', null, 'or spend');
select throws_ok($$ select * from public.admin_activity() $$, '42501', null, 'or operator activity');
select throws_ok($$ select public.admin_set_signup_open(true) $$, '42501', null, 'or flip signup');

select set_config('request.jwt.claims',
  '{"sub":"ad0e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Adoption
-- ---------------------------------------------------------------------------
select ok(
  (select first_call_at is not null and first_insight_at is not null and first_ticket_at is not null and calls >= 1
     from public.admin_adoption() where company_id = '00000000-0000-4000-8000-00000000000a'),
  'a company with a call, an insight and a ticket reached every step'
);
select ok(
  (select first_call_at is not null and first_insight_at is null and first_ticket_at is null and calls = 0
     from public.admin_adoption() where company_id = 'ad0e0001-0000-4000-8000-0000000000cc'),
  'an erased call still counts as a first call; no ticket, no ticket step'
);

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select tier, model, detector, calls, usd from public.admin_spend_by_week(1) $$,
  $$ values ('t1'::text, 'claude-haiku-4-5'::text, 't1-detect@test'::text, 1::bigint, 1.0000::numeric) $$,
  'this week''s spend, by tier, model and detector, at the published rate'
);
select throws_ok($$ select * from public.admin_spend_by_week(0) $$, '22023', null, 'a number of weeks that means something');

-- ---------------------------------------------------------------------------
-- Activity, and the signup log
-- ---------------------------------------------------------------------------
select lives_ok($$ select public.admin_set_signup_open(true) $$, 'the operator opens signup');
select lives_ok($$ select public.admin_set_signup_open(true) $$, 'and presses it again');
select is(
  (select count(*)::integer from public.app_settings_events),
  1,
  'a change is logged once; a press that changes nothing is not a change'
);
select lives_ok($$ select public.admin_set_signup_open(false) $$, 'and closes it');
select results_eq(
  $$ select action, subject from public.admin_activity()
      where action in ('closed signup', 'opened signup', 'opened an account')
      order by at desc, action $$,
  $$ values ('closed signup'::text, 'self-serve signup'::text),
            ('opened an account', 'owner@acme.test'),
            ('opened signup', 'self-serve signup') $$,
  'one list of what operators did, from every record they write'
);
select is(
  (select actor from public.admin_activity() where action = 'opened an account'),
  'operator@test.tesserafy.local',
  'each entry names the operator'
);

select * from finish();
rollback;
