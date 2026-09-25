-- Self-serve sign-up: closed until the operator opens it, confirmed
-- addresses only, one company per account, ever.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('adad0001-0000-4000-8000-000000000001', 'brand@new.test', 'authenticated', 'authenticated', now()),
  ('adad0001-0000-4000-8000-000000000002', 'unconfirmed@new.test', 'authenticated', 'authenticated', null),
  ('adad0001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated', now()),
  ('adad0001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated', now());
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'adad0001-0000-4000-8000-000000000003', 'member');
insert into public.platform_admins (user_id, note) values
  ('adad0001-0000-4000-8000-000000000004', 'test operator');

-- Closed by default
set local role anon;
select is(public.signup_is_open(), false, 'sign-up starts closed, and anyone may ask');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_my_company('Brand New Co') $$,
  '42501', null,
  'while closed, nobody creates a company — not even straight through the API'
);
select throws_ok(
  $$ select public.admin_set_signup_open(true) $$,
  '42501', null,
  'and nobody but an operator can open it'
);

-- The operator opens it
select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.admin_set_signup_open(true) $$, 'the operator opens sign-up');
select is(
  (select updated_by from public.app_settings),
  'adad0001-0000-4000-8000-000000000004'::uuid,
  'recorded as them'
);

-- Who may create one
select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_my_company('Unconfirmed Co') $$,
  '42501', null,
  'an unconfirmed address cannot create a company'
);

select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_my_company('Second Co') $$,
  '22023', null,
  'someone already in a company cannot start another'
);

select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_my_company(' x ') $$,
  '22023', null,
  'a name needs at least two characters'
);

create temporary table made (id uuid) on commit drop;
grant all on made to authenticated;
insert into made select public.create_my_company('  Brand New Co  ');

reset role;
select is(
  (select c.name || '/' || c.plan || '/' || s.status from public.companies c
     join public.subscriptions s on s.company_id = c.id where c.id = (select id from made)),
  'Brand New Co/trial/trialing',
  'a confirmed brand gets its company, on the trial'
);
select is(
  (select role from public.company_members
    where company_id = (select id from made) and user_id = 'adad0001-0000-4000-8000-000000000001'),
  'owner',
  'as its owner'
);

-- One company per account, ever
delete from public.company_members where company_id = (select id from made);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.create_my_company('Another Trial Co') $$,
  '22023', null,
  'having left it, the same account cannot create a second company for a second trial'
);

-- Closing again
select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.admin_set_signup_open(false) $$, 'the operator closes it again');
select is(
  (select signup_open from public.app_settings),
  false,
  'and it is closed'
);

select set_config('request.jwt.claims',
  '{"sub":"adad0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_settings),
  0,
  'a customer cannot read the settings row'
);

select * from finish();
rollback;
