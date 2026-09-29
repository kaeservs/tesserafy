-- Preparing for a call: who may write, change and delete a prep; that a
-- LinkedIn field takes only a profile address; that a brief written from
-- other words is cleared; that none of it crosses a tenant; and that closing
-- a company forgets the people it was meeting. Runs with `supabase test db`.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email, aud, role) values
  ('c0a10001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('c0a10001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('c0a10001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated'),
  ('c0a10001-0000-4000-8000-000000000004', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'c0a10001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'c0a10001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'c0a10001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'c0a10001-0000-4000-8000-000000000004', 'owner');
insert into public.accounts (id, company_id, name) values
  ('c0a10001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Harbor & Pine'),
  ('c0a10001-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'Globex customer');

create temporary table made (label text, id uuid);
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0a10001-0000-4000-8000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$ select public.save_call_prep('Tom Okafor', p_linkedin_url => 'https://evil.example/in/tom') $$,
  '22023', null, 'the LinkedIn field takes only a LinkedIn profile address'
);
select throws_ok(
  $$ select public.save_call_prep('Tom Okafor', p_account_id => 'c0a10001-0000-4000-8000-0000000000b1') $$,
  'P0002', null, 'nor can a prep name another company''s customer'
);
insert into made select 'prep', public.save_call_prep(
  'Tom Okafor', 'Head of Operations', 'https://www.linkedin.com/in/tom-okafor-example/',
  'Head of Operations at Harbor & Pine. Twelve years in freight.', 'c0a10001-0000-4000-8000-0000000000a1',
  'discovery', now() + interval '1 day');
select ok((select id from made where label = 'prep') is not null, 'a member writes a prep');

select lives_ok(
  $$ select public.set_call_prep_brief((select id from made where label = 'prep'), '{"about":[],"questions":[]}'::jsonb, 'claude-sonnet-5') $$,
  'and stores its brief'
);
select is((select brief_model from public.call_preps), 'claude-sonnet-5', 'with the model that wrote it');

select lives_ok(
  $$ select public.save_call_prep('Tom Okafor', 'Head of Operations', null,
       'Head of Operations. Now also runs procurement.', 'c0a10001-0000-4000-8000-0000000000a1',
       'discovery', null, (select id from made where label = 'prep')) $$,
  'the author can change it'
);
select is((select brief from public.call_preps), null, 'and a brief written from other words is cleared');

select set_config('request.jwt.claims', '{"sub":"c0a10001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.call_preps), 1, 'a colleague reads it');
select throws_ok(
  $$ select public.delete_call_prep((select id from made where label = 'prep')) $$,
  '42501', null, 'but cannot delete it'
);
select throws_ok(
  $$ select public.set_call_prep_brief((select id from made where label = 'prep'), '{}'::jsonb, 'x') $$,
  '42501', null, 'nor write its brief'
);

select set_config('request.jwt.claims', '{"sub":"c0a10001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.call_preps), 0, 'another company cannot read it');
select throws_ok(
  $$ select public.delete_call_prep((select id from made where label = 'prep')) $$,
  'P0002', null, 'nor find it to delete'
);

select set_config('request.jwt.claims', '{"sub":"c0a10001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select 'second', public.save_call_prep('Priya Raman');
select lives_ok($$ select public.delete_call_prep((select id from made where label = 'second')) $$, 'an owner can delete one');

-- Deleting the customer leaves the prep, unlinked.
reset role;
delete from public.accounts where id = 'c0a10001-0000-4000-8000-0000000000a1';
select is((select account_id from public.call_preps where id = (select id from made where label = 'prep')), null,
  'deleting the customer unlinks the prep rather than blocking');

update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.call_preps where company_id = '00000000-0000-4000-8000-00000000000a'), 0,
  'closing a company forgets the people it was meeting');

select * from finish();
rollback;
