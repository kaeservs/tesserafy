-- Each person's overlay settings: their own row only; a look from the
-- overlay's own lists; a next call that is their company's prep, cleared
-- when the prep goes. Runs with `supabase test db` (pgTAP). Rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('0f000001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('0f000001-0000-4000-8000-000000000002', 'other@acme.test', 'authenticated', 'authenticated'),
  ('0f000001-0000-4000-8000-000000000003', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '0f000001-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000a', '0f000001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '0f000001-0000-4000-8000-000000000003', 'owner');
insert into public.call_preps (id, company_id, person_name, created_by) values
  ('0f000001-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a', 'Dana', '0f000001-0000-4000-8000-000000000002'),
  ('0f000001-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000000b', 'Their prep', '0f000001-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f000001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(public.set_overlay_look('{"theme":"light","opacity":80}') ->> 'theme', 'light', 'a person sets how their overlay looks');
select is(public.set_overlay_look('{"size":"large"}'), '{"theme":"light","opacity":80,"size":"large"}'::jsonb,
  'a change merges into what was set');
select throws_ok($$ select public.set_overlay_look('{"theme":"neon"}') $$, '22023', null, 'from the overlay''s own list only');
select throws_ok($$ select public.set_overlay_look('{"opacity":5}') $$, '22023', null, 'never so faint it cannot be read');
select throws_ok($$ select public.set_overlay_look('{"position":{"x":1}}') $$, '22023', null,
  'where it sits is not set here: that is each computer''s');

select lives_ok($$ select public.set_next_call('0f000001-0000-4000-8000-0000000000b1') $$,
  'a colleague''s prep in the company can be my next call');
select throws_ok($$ select public.set_next_call('0f000001-0000-4000-8000-0000000000b2') $$, 'P0002', null,
  'another company''s cannot');

select set_config('request.jwt.claims', '{"sub":"0f000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.user_preferences), 0, 'nobody reads another person''s settings');
select throws_ok($$ insert into public.user_preferences (user_id) values ('0f000001-0000-4000-8000-000000000002') $$, '42501', null,
  'nor writes them except through the functions');

reset role;
delete from public.call_preps where id = '0f000001-0000-4000-8000-0000000000b1';
select is((select next_prep_id from public.user_preferences where user_id = '0f000001-0000-4000-8000-000000000001'), null,
  'deleting the prep clears it as the next call');
select is((select overlay_look ->> 'size' from public.user_preferences where user_id = '0f000001-0000-4000-8000-000000000001'), 'large',
  'and leaves the look alone');

select * from finish();
rollback;
