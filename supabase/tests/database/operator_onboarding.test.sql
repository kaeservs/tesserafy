-- Operator onboarding: who may create a company or add a person, what is
-- refused, and that the record is written before the account exists.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email, aud, role) values
  ('aaaa0001-0000-4000-8000-000000000001', 'operator-one@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('aaaa0001-0000-4000-8000-000000000002', 'operator-two@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('aaaa0001-0000-4000-8000-000000000003', 'customer@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('aaaa0001-0000-4000-8000-000000000001', 'test operator one'),
  ('aaaa0001-0000-4000-8000-000000000002', 'test operator two');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'aaaa0001-0000-4000-8000-000000000003', 'owner');

create temporary table opened (label text, id uuid) on commit drop;
grant all on opened to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- A customer cannot
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"aaaa0001-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.open_account_provisioning('new@brand.example', 'owner', p_company_name => 'Brand') $$,
  '42501', null,
  'a customer, even an owner, cannot create a company'
);

select is(
  (select count(*)::integer from public.account_provisioning),
  0,
  'and cannot read the provisioning log'
);

-- ---------------------------------------------------------------------------
-- An operator, and what is refused
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"aaaa0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.open_account_provisioning('new@brand.example', 'member', p_company_name => 'Brand') $$,
  '22023', null,
  'the first person in a new company is its owner'
);

select throws_ok(
  $$ select public.open_account_provisioning('new@brand.example', 'owner',
       p_company_id => '00000000-0000-4000-8000-00000000000a', p_company_name => 'Brand') $$,
  '22023', null,
  'a new company or an existing one, not both'
);

select throws_ok(
  $$ select public.open_account_provisioning('not-an-address', 'owner', p_company_name => 'Brand') $$,
  '22023', null,
  'an email address is required'
);

select throws_ok(
  $$ select public.open_account_provisioning('Customer@Test.Tesserafy.Local', 'member',
       p_company_id => '00000000-0000-4000-8000-00000000000b') $$,
  '22023', null,
  'someone already in a company is refused, whatever the case of their address'
);

-- The record comes first: it exists before any account does.
insert into opened
select 'new', (public.open_account_provisioning('  New@Brand.example ', 'owner',
                 p_company_name => 'Brand Co', p_plan => 'pilot')).id;

select is(
  (select email from public.account_provisioning where id = (select id from opened where label = 'new')),
  'new@brand.example',
  'the address is recorded trimmed and lower-cased'
);

-- ---------------------------------------------------------------------------
-- The key creates the account (simulated as the superuser), then completion
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, aud, role) values
  ('aaaa0001-0000-4000-8000-000000000004', 'new@brand.example', 'authenticated', 'authenticated'),
  ('aaaa0001-0000-4000-8000-000000000005', 'someone-else@brand.example', 'authenticated', 'authenticated');
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"aaaa0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.complete_account_provisioning((select id from opened where label = 'new'),
       'aaaa0001-0000-4000-8000-000000000004', true) $$,
  '42501', null,
  'another operator cannot complete a record they did not open'
);

select set_config('request.jwt.claims',
  '{"sub":"aaaa0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.complete_account_provisioning((select id from opened where label = 'new'),
       'aaaa0001-0000-4000-8000-000000000005', true) $$,
  '22023', null,
  'the account must be the one that was recorded'
);

select lives_ok(
  $$ select public.complete_account_provisioning((select id from opened where label = 'new'),
       'aaaa0001-0000-4000-8000-000000000004', true) $$,
  'the operator who opened it completes it'
);

reset role;

select is(
  (select c.name || '/' || c.plan || '/' || m.role
     from public.company_members m join public.companies c on c.id = m.company_id
    where m.user_id = 'aaaa0001-0000-4000-8000-000000000004'),
  'Brand Co/pilot/owner',
  'the company is created with its plan, and the person is its owner'
);

select ok(
  (select completed_at is not null and new_account and user_id = 'aaaa0001-0000-4000-8000-000000000004'
          and company_id is not null
     from public.account_provisioning where id = (select id from opened where label = 'new')),
  'and the record is closed with who and where'
);

-- ---------------------------------------------------------------------------
-- A second person, into that company
-- ---------------------------------------------------------------------------
-- Read as the superuser: an operator is not a member, so RLS hides the row.
insert into opened
select 'brand', company_id from public.company_members
 where user_id = 'aaaa0001-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaa0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into opened
select 'second', (public.open_account_provisioning('someone-else@brand.example', 'member',
  p_company_id => (select id from opened where label = 'brand'))).id;

select lives_ok(
  $$ select public.complete_account_provisioning((select id from opened where label = 'second'),
       'aaaa0001-0000-4000-8000-000000000005', false) $$,
  'an existing account is added to an existing company'
);

select throws_ok(
  $$ select public.complete_account_provisioning((select id from opened where label = 'second'),
       'aaaa0001-0000-4000-8000-000000000005', false) $$,
  '22023', null,
  'a record is completed once'
);

reset role;
select is(
  (select count(*)::integer from public.company_members m
     join public.company_members owner on owner.company_id = m.company_id
    where owner.user_id = 'aaaa0001-0000-4000-8000-000000000004'
      and m.user_id = 'aaaa0001-0000-4000-8000-000000000005' and m.role = 'member'),
  1,
  'as a member of the same company'
);

select * from finish();
rollback;
