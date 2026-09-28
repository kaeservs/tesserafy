-- Two-step sign-in for operators: off by default, so nothing changes until it
-- is switched on; switching needs a session that passed the second step, and
-- is refused while any operator would be locked out; once on, an operator
-- without the second step is not an operator anywhere.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('3fa00001-0000-4000-8000-000000000001', 'ops-one@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('3fa00001-0000-4000-8000-000000000002', 'ops-two@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('3fa00001-0000-4000-8000-000000000001', 'test operator one'),
  ('3fa00001-0000-4000-8000-000000000002', 'test operator two');
-- Operator one has an authenticator; operator two does not, yet.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('3fa00001-0000-4000-8000-0000000000f1', '3fa00001-0000-4000-8000-000000000001', 'phone', 'totp', 'verified', now(), now());

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Off: as before
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"3fa00001-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select lives_ok($$ select * from public.admin_activity(5) $$, 'not required: an operator on a password alone is still an operator');

select set_config('request.jwt.claims',
  '{"sub":"3fa00001-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$ select public.admin_set_operator_mfa(true) $$, '42501', null,
  'switching it on needs a session that passed the second step');

select set_config('request.jwt.claims',
  '{"sub":"3fa00001-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$ select public.admin_set_operator_mfa(true) $$, '22023', null,
  'and is refused while a colleague has no authenticator — they would be locked out');
select is(
  (select string_agg((o ->> 'email') || '=' || (o ->> 'has_factor'), ', ')
     from jsonb_array_elements(public.admin_operator_mfa() -> 'operators') o),
  'ops-one@test.tesserafy.local=true, ops-two@test.tesserafy.local=false',
  'the console can say who is missing one'
);

reset role;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values ('3fa00001-0000-4000-8000-0000000000f2', '3fa00001-0000-4000-8000-000000000002', 'phone', 'totp', 'verified', now(), now());
set local role authenticated;

select lives_ok($$ select public.admin_set_operator_mfa(true) $$, 'with everyone enrolled, it switches on');

-- ---------------------------------------------------------------------------
-- On
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"3fa00001-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$ select * from public.admin_activity(5) $$, '42501', null,
  'an operator on a password alone is refused by every admin function');
select is(
  (select count(*)::integer from public.companies),
  0,
  'and the admin policies show them nothing of other companies'
);
select throws_ok($$ select public.admin_set_operator_mfa(false) $$, '42501', null,
  'a password alone cannot switch it off again');

select set_config('request.jwt.claims',
  '{"sub":"3fa00001-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$ select * from public.admin_activity(5) $$, 'the same operator with the second step is an operator');
select ok((select count(*) from public.companies) > 0, 'and reads across companies again');
select is(
  (select action from public.admin_activity(5) where action like '%two-step%' limit 1),
  'required two-step sign-in',
  'switching it on is in the activity log'
);

select lives_ok($$ select public.admin_set_operator_mfa(false) $$, 'with the second step, it can be switched off');

select * from finish();
rollback;
