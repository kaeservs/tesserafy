-- The early-access list: nobody outside adds to it since its form went
-- (security review, 2026-10-19), a visitor reads nothing of it, and only
-- operators read it, mark who was invited and remove an entry. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, aud, role) values
  ('ea000001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('ea000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('ea000001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'ea000001-0000-4000-8000-000000000002');
-- Entries from when the form was up.
insert into public.early_access (email, company, use_case) values ('dana@northwind.test', 'Northwind', 'sales');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select public.request_early_access('dana@northwind.test', 'Northwind', 'sales') $$, '42501', null,
  'a visitor cannot add to the list: the form is gone, and its function with it');
select throws_ok($$ select * from public.early_access $$, '42501', null, 'a visitor cannot read the list');
select throws_ok($$ select public.admin_mark_early_access(gen_random_uuid(), true) $$, '42501', null, 'nor mark anyone');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.request_early_access('lee@northwind.test') $$, '42501', null,
  'nor can a signed-in customer');
select is((select count(*)::int from public.early_access), 0, 'a customer does not read the list');

select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select company || ' ' || use_case from public.early_access where email = 'dana@northwind.test'), 'Northwind sales',
  'an operator reads it');
select public.admin_mark_early_access((select id from public.early_access where email = 'dana@northwind.test'), true);
select ok((select invited_at is not null from public.early_access where email = 'dana@northwind.test'),
  'and marks who was invited');

select public.admin_remove_early_access((select id from public.early_access where email = 'dana@northwind.test'));
select is((select count(*)::int from public.early_access where email = 'dana@northwind.test'), 0, 'and removes an entry, which is gone');

select set_config('request.jwt.claims', '{"sub":"ea000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_remove_early_access(gen_random_uuid()) $$, '42501', null, 'a customer cannot remove anyone');

select * from finish();
rollback;
