-- Whether the overlay shows itself when a call starts: on by default, each
-- person's own to switch, and nobody else's.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, aud, role) values
  ('dc000001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('dc000001-0000-4000-8000-000000000002', 'other@acme.test', 'authenticated', 'authenticated');
insert into public.user_preferences (user_id) values ('dc000001-0000-4000-8000-000000000002');

select is((select detect_calls from public.user_preferences where user_id = 'dc000001-0000-4000-8000-000000000002'), true, 'on by default');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dc000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.set_detect_calls(false), false, 'a person switches it off for themselves');
select throws_ok($$ select public.set_detect_calls(null) $$, '22023', null, 'on or off, nothing else');
reset role;
select is(
  (select string_agg(user_id::text || '=' || detect_calls, ',' order by user_id) from public.user_preferences
    where user_id in ('dc000001-0000-4000-8000-000000000001', 'dc000001-0000-4000-8000-000000000002')),
  'dc000001-0000-4000-8000-000000000001=false,dc000001-0000-4000-8000-000000000002=true',
  'and nobody else''s'
);

select * from finish();
rollback;
