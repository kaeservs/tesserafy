-- The early-access list: a visitor adds an address and nothing else, asking
-- twice is the same as once, a flood is capped, and only operators read it.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('ea000001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('ea000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('ea000001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'ea000001-0000-4000-8000-000000000002');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(public.request_early_access('Dana@Northwind.test', 'Northwind', 'sales'), true, 'a visitor can ask');
select is(public.request_early_access('dana@northwind.test', 'Someone else', 'support'), true,
  'asking again is answered the same, so the form tells nobody who is on the list');
select throws_ok($$ select public.request_early_access('not an address') $$, '22023', null, 'an address is an address');
select throws_ok($$ select * from public.early_access $$, '42501', null, 'a visitor cannot read the list');
select throws_ok($$ select public.admin_mark_early_access(gen_random_uuid(), true) $$, '42501', null, 'nor mark anyone');

reset role;
select is((select company || ' ' || use_case from public.early_access where email = 'dana@northwind.test'), 'Northwind sales',
  'one row an address, kept as first asked');

-- The hourly cap.
insert into public.early_access (email) select 'flood' || n || '@example.test' from generate_series(1, 59) n;
set local role anon;
select throws_ok($$ select public.request_early_access('one-more@example.test') $$, '54000', null, 'a flood is capped');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.early_access), 0, 'a customer does not read the list');

select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.admin_mark_early_access((select id from public.early_access where email = 'dana@northwind.test'), true);
select ok((select invited_at is not null from public.early_access where email = 'dana@northwind.test'),
  'an operator reads it and marks who was invited');

select public.admin_remove_early_access((select id from public.early_access where email = 'dana@northwind.test'));
select is((select count(*)::int from public.early_access where email = 'dana@northwind.test'), 0, 'and removes an entry, which is gone');

select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_remove_early_access(gen_random_uuid()) $$, '42501', null, 'a customer cannot remove anyone');

select * from finish();
rollback;
