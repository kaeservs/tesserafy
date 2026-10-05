-- A person's name is theirs alone and cannot carry an address or a line
-- break; the console's adoption counts the newest features; a company's
-- integrations and billing are for operators only, and carry no token.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, aud, role) values
  ('9f0f0000-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('9f0f0000-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('9f0f0000-0000-4000-8000-000000000003', 'op@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '9f0f0000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '9f0f0000-0000-4000-8000-000000000002', 'member');
insert into public.platform_admins (user_id, note) values ('9f0f0000-0000-4000-8000-000000000003', 'profile test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9f0f0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.set_display_name('  Sam Seller ');
select is((select display_name from public.user_preferences), 'Sam Seller', 'a person sets their own name');
select throws_ok($$ select public.set_display_name('Sam <ceo@bank.test>') $$, '23514', null, 'a name that would forge a sender is refused');
select public.connect_crm('hubspot', '12345678', 'v1:a:b:c', 'wxyz');
select public.connect_calendar('google', 'seller@acme.test', 'v1:a:b:c');

select set_config('request.jwt.claims', '{"sub":"9f0f0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.user_preferences), 0, 'a colleague does not read it');
select throws_ok($$ select public.admin_company_integrations('00000000-0000-4000-8000-00000000000a') $$, '42501', null,
  'a customer cannot read the console''s view of a company');
select throws_ok($$ select * from public.admin_feature_adoption(90) $$, '42501', null, 'nor its adoption');

select set_config('request.jwt.claims', '{"sub":"9f0f0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select calendars from public.admin_feature_adoption(90) where company_id = '00000000-0000-4000-8000-00000000000a'), 1::bigint,
  'adoption counts the people with a calendar connected');
select is((select pays_stripe from public.admin_feature_adoption(90) where company_id = '00000000-0000-4000-8000-00000000000a'), false,
  'and whether the company pays through Stripe');
select is((select admin_company_integrations('00000000-0000-4000-8000-00000000000a') -> 'crm' ->> 'account_ref'), '12345678',
  'an operator sees which CRM the company connected');
select ok(position('v1:' in admin_company_integrations('00000000-0000-4000-8000-00000000000a')::text) = 0,
  'and never a token');

select * from finish();
rollback;
