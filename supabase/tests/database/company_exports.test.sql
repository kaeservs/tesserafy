-- Recording an export: owners only, recorded as whom, readable by whom.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, aud, role) values
  ('eeee0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('eeee0001-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated'),
  ('eeee0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'eeee0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'eeee0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'eeee0001-0000-4000-8000-000000000003', 'owner');

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"eeee0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.record_company_export() $$,
  '42501', null,
  'a member cannot export the company''s data'
);

select set_config('request.jwt.claims',
  '{"sub":"eeee0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.record_company_export() $$,
  'an owner can'
);

select is(
  (select email || '/' || conversations from public.company_exports),
  'owner@acme.test/' || (select count(*) from public.conversations
                          where company_id = '00000000-0000-4000-8000-00000000000a'),
  'recorded as the owner, with how many calls went'
);

select is(
  (select company_id from public.company_exports),
  '00000000-0000-4000-8000-00000000000a'::uuid,
  'against their own company, taken from the session'
);

select set_config('request.jwt.claims',
  '{"sub":"eeee0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.company_exports),
  0,
  'a member cannot read the record'
);

select set_config('request.jwt.claims',
  '{"sub":"eeee0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.company_exports),
  0,
  'nor can another company''s owner'
);

select * from finish();
rollback;
