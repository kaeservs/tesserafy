-- Which overlay each person runs: recorded as the person, one row a platform,
-- read by them and by operators only. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('0e000001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('0e000001-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('0e000001-0000-4000-8000-000000000003', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', '0e000001-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000000a', '0e000001-0000-4000-8000-000000000002');
insert into public.platform_admins (user_id, note) values ('0e000001-0000-4000-8000-000000000003', 'test operator');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.record_overlay_seen('0.1.14', 'win32');
select public.record_overlay_seen('0.1.15', 'win32');
select is((select version from public.overlay_seen), '0.1.15', 'the newest version replaces the last, per platform');
select throws_ok($$ select public.record_overlay_seen('latest; drop table x', 'win32') $$, '22023', null, 'a version is a version');
select throws_ok($$ select public.record_overlay_seen('0.1.15', 'amiga') $$, '22023', null, 'and a platform is a platform');

select set_config('request.jwt.claims', '{"sub":"0e000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.overlay_seen), 0, 'a colleague does not read someone else''s');
select throws_ok($$ select * from public.admin_overlay_seen() $$, '42501', null, 'nor the console''s list');

select set_config('request.jwt.claims', '{"sub":"0e000001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select version from public.admin_overlay_seen() where email = 'seller@acme.test'), '0.1.15', 'an operator sees who runs which');
select is((select company from public.admin_overlay_seen() where email = 'seller@acme.test'),
  (select name from public.companies where id = '00000000-0000-4000-8000-00000000000a'), 'and their company');

select * from finish();
rollback;
