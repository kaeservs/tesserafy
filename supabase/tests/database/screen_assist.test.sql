-- Whether a company's overlay may send a screenshot with a question: on by
-- default, switched by an owner only, for their own company only.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, aud, role) values
  ('5c000001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('5c000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5c000001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '5c000001-0000-4000-8000-000000000002', 'member');

select is((select screen_assist from public.companies where id = '00000000-0000-4000-8000-00000000000a'), true, 'on by default');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"5c000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_screen_assist(false) $$, '42501', null, 'a member cannot switch it');

select set_config('request.jwt.claims', '{"sub":"5c000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.set_screen_assist(false), false, 'an owner switches it off');
reset role;
select is((select screen_assist from public.companies where id = '00000000-0000-4000-8000-00000000000a'), false, 'for their company');
select is((select screen_assist from public.companies where id = '00000000-0000-4000-8000-00000000000b'), true, 'and no other');

select * from finish();
rollback;
