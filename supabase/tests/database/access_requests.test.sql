-- An owner asking for a teammate, and the operator answering.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('ffff0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('ffff0001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('ffff0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('ffff0001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ffff0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'ffff0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'ffff0001-0000-4000-8000-000000000003', 'owner');
insert into public.platform_admins (user_id, note) values
  ('ffff0001-0000-4000-8000-000000000004', 'test operator');

create temporary table ids (label text, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_teammate('new@acme.test', 'member') $$,
  '42501', null,
  'a member cannot ask for someone to be added'
);

select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into ids select 'first', public.request_teammate('  New@Acme.test ', 'member', 'joins sales on Monday');

select is(
  (select email || '/' || role || '/' || note from public.access_requests),
  'new@acme.test/member/joins sales on Monday',
  'an owner asks: address tidied, role and note kept'
);

select throws_ok(
  $$ select public.request_teammate('new@acme.test', 'member') $$,
  '22023', null,
  'asking twice for the same address is one request'
);
select throws_ok(
  $$ select public.request_teammate('Member@Acme.test', 'member') $$,
  '22023', null,
  'nor can someone already on the team be asked for'
);
select throws_ok(
  $$ select public.request_teammate('not an address', 'member') $$,
  '22023', null,
  'an address is required'
);

select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.access_requests),
  0,
  'another company''s owner sees none of it'
);
select lives_ok(
  $$ select public.request_teammate('new@acme.test', 'member') $$,
  'and asking for the same address in their own company is their own request'
);

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.resolve_access_request((select id from ids where label = 'first'), 'added') $$,
  '42501', null,
  'an owner cannot answer their own request'
);

select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.admin_access_requests()),
  2,
  'the operator sees every open request'
);
select is(
  (select company_name || '/' || requested_by from public.admin_access_requests()
    where company_id = '00000000-0000-4000-8000-00000000000a'),
  'Acme Robotics/owner@acme.test',
  'with the company and who asked'
);

select throws_ok(
  $$ select public.resolve_access_request((select id from ids where label = 'first'), 'added') $$,
  '22023', null,
  '"added" is refused while the person is not actually in the company'
);
select throws_ok(
  $$ select public.resolve_access_request((select id from ids where label = 'first'), 'declined') $$,
  '22023', null,
  'a decline needs a reason'
);

-- The console provisions the person (simulated as the superuser), then closes it.
reset role;
insert into auth.users (id, email, aud, role) values
  ('ffff0001-0000-4000-8000-000000000005', 'new@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ffff0001-0000-4000-8000-000000000005', 'member');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000004","role":"authenticated"}', true);

select lives_ok(
  $$ select public.resolve_access_request((select id from ids where label = 'first'), 'added') $$,
  'once they are in, the operator closes it as added'
);

select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select resolution from public.access_requests where id = (select id from ids where label = 'first')),
  'added',
  'and the owner who asked can see that'
);

select set_config('request.jwt.claims',
  '{"sub":"ffff0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.admin_access_requests()),
  1,
  'an answered request leaves the operator''s list'
);

-- The one left is Globex's. Once Globex is closed, nobody can be added to it,
-- so its request is not waiting on anyone.
select public.close_company('00000000-0000-4000-8000-00000000000b', 'pilot ended', 'Globex Logistics');
select is(
  (select count(*)::integer from public.admin_access_requests()),
  0,
  'a closed company''s open requests leave the list too'
);

select * from finish();
rollback;
