-- Who reads which failures: an operator every one, a member their company's,
-- nobody else anything. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, aud, role) values
  ('fa11ed01-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('fa11ed01-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('fa11ed01-0000-4000-8000-000000000003', 'nobody@nowhere.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('fa11ed01-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'fa11ed01-0000-4000-8000-000000000002', 'member');

insert into public.system_failures (company_id, source, kind, message) values
  ('00000000-0000-4000-8000-00000000000a', 'api/extract', 'model_unavailable', 'overloaded'),
  ('00000000-0000-4000-8000-00000000000b', 'api/extract', 'database', 'policy refused'),
  (null, 'api/detect', 'model_rejected', 'temperature is deprecated');

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"fa11ed01-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.system_failures), 3,
  'an operator reads every failure, including those with no company');

select set_config('request.jwt.claims',
  '{"sub":"fa11ed01-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.system_failures), 1,
  'a member reads only their own company''s');
select is((select source from public.system_failures), 'api/extract',
  'and it is the one that is theirs');

select set_config('request.jwt.claims',
  '{"sub":"fa11ed01-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.system_failures), 0,
  'someone in no company reads none');

select * from finish();
rollback;
