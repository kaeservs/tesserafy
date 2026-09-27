-- Handing over ownership: who may change a role, the one rule (a company keeps
-- an owner), and the record. Runs with `supabase test db` (pgTAP). Everything
-- rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('301e0001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('301e0001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('301e0001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated'),
  ('301e0001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('301e0001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '301e0001-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '301e0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '301e0001-0000-4000-8000-000000000004', 'owner');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- A member cannot
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000003', 'owner') $$,
  '42501', null,
  'a member cannot make themselves an owner'
);

-- ---------------------------------------------------------------------------
-- An owner, in their own company
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_like(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000002', 'member') $$,
  '%a company needs an owner%',
  'the only owner cannot step down'
);
select throws_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000004', 'member') $$,
  '22023', null,
  'nor change anyone outside their company'
);
select throws_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000003', 'admin') $$,
  '22023', null,
  'a role is owner or member'
);
select throws_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000003', 'member') $$,
  '22023', null,
  'a change has to change something'
);

select lives_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000003', 'owner') $$,
  'an owner makes a member an owner'
);
select lives_ok(
  $$ select public.set_member_role('301e0001-0000-4000-8000-000000000002', 'member') $$,
  'and, with another owner now, steps down'
);

reset role;
select results_eq(
  $$ select user_id::text, role from public.company_members
      where company_id = '00000000-0000-4000-8000-00000000000a' order by user_id $$,
  $$ values ('301e0001-0000-4000-8000-000000000002', 'member'),
            ('301e0001-0000-4000-8000-000000000003', 'owner') $$,
  'ownership has changed hands'
);
select results_eq(
  $$ select email, from_role, to_role, changed_by::text from public.membership_role_changes
      where company_id = '00000000-0000-4000-8000-00000000000a' order by changed_at, to_role desc $$,
  $$ values ('member@acme.test', 'member', 'owner', '301e0001-0000-4000-8000-000000000002'),
            ('owner@acme.test', 'owner', 'member', '301e0001-0000-4000-8000-000000000002') $$,
  'each change is recorded, with the address and who made it'
);
set local role authenticated;

-- The new owner reads the record; the one who stepped down, now a member, does not.
select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.membership_role_changes), 2, 'owners read their company''s role changes');
select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.membership_role_changes), 0, 'members do not');

-- Now a member, they can ask for their account to be deleted after all.
select lives_ok(
  $$ select public.request_account_deletion('owner@acme.test') $$,
  'having stepped down, the former owner can ask to be deleted'
);

-- ---------------------------------------------------------------------------
-- The operator, in any company
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.admin_set_member_role('00000000-0000-4000-8000-00000000000b', '301e0001-0000-4000-8000-000000000004', 'member') $$,
  '42501', null,
  'a customer cannot use the operator''s door'
);

select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_like(
  $$ select public.admin_set_member_role('00000000-0000-4000-8000-00000000000b', '301e0001-0000-4000-8000-000000000004', 'member') $$,
  '%a company needs an owner%',
  'the operator cannot leave a company without an owner either'
);

-- An owner asking to be deleted is told what they can do themselves.
select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_like(
  $$ select public.request_account_deletion('owner@globex.test') $$,
  '%step down to member%',
  'an owner asking to be deleted is told to hand over and step down first'
);

select set_config('request.jwt.claims',
  '{"sub":"301e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.membership_role_changes),
  2,
  'operators read every company''s role changes'
);

select * from finish();
rollback;
