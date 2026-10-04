-- A call's meeting (ADR 0026): the caller's own meeting at the call's time is
-- found, its outside attendees kept with the call for the company to read, and
-- its customer set by their domain; no meeting, nothing kept; another person's
-- calendar is never used; another company reads none of it; erasing the call
-- erases them. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, aud, role) values
  ('ca7e0000-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('ca7e0000-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('ca7e0000-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ca7e0000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'ca7e0000-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'ca7e0000-0000-4000-8000-000000000003', 'owner');

create temporary table made (n int, id uuid);
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ca7e0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.save_account('Northwind Traders', 'northwind.test');
select public.connect_calendar('google', 'seller@acme.test', 'v1:a:b:c');
select public.record_calendar_sync('google', format('[
  {"external_id":"now","title":"Northwind discovery","starts_at":"%s","ends_at":"%s",
   "attendees":[{"email":"Dana@Northwind.test","name":"Dana Whitfield"},{"email":"lee@northwind.test","name":null},{"email":"not an address"}]},
  {"external_id":"later","title":"Globex demo","starts_at":"%s","ends_at":"%s","attendees":[{"email":"tom@globex.test"}]}
]', now() - interval '5 minutes', now() + interval '55 minutes', now() + interval '3 hours', now() + interval '4 hours')::jsonb);

select public.agree_to_recording('2026-10-02', 'I will tell everyone on every call I record that it is recorded, and that is my responsibility.', 'overlay');
insert into made select 1, public.start_live_conversation('Live call', p_consent_statement => 'test');

-- A colleague starting the link finds nothing of theirs: another person's calendar is never used.
select set_config('request.jwt.claims', '{"sub":"ca7e0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.link_call_to_meeting((select id from made where n = 1)), 0, 'a colleague''s calendar has no meeting, and the seller''s is not theirs to use');

select set_config('request.jwt.claims', '{"sub":"ca7e0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.link_call_to_meeting((select id from made where n = 1)), 2, 'the caller''s meeting under way is found, and its real addresses kept');
select is((select string_agg(email || ':' || coalesce(name, '-') || ':' || meeting_title, ', ' order by email) from public.call_attendees),
  'dana@northwind.test:Dana Whitfield:Northwind discovery, lee@northwind.test:-:Northwind discovery', 'address, name and the meeting, nothing else');
select is((select a.domain from public.conversations c join public.accounts a on a.id = c.account_id where c.id = (select id from made where n = 1)),
  'northwind.test', 'and the call gets the customer whose domain they are at');
select is(public.link_call_to_meeting((select id from made where n = 1)), 0, 'linking again adds nothing twice');

select set_config('request.jwt.claims', '{"sub":"ca7e0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.call_attendees), 2, 'a colleague reads who was on the call, as they read the call');

select set_config('request.jwt.claims', '{"sub":"ca7e0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.call_attendees), 0, 'another company reads none of it');

reset role;
delete from public.conversations where id = (select id from made where n = 1);
select is((select count(*)::int from public.call_attendees), 0, 'erasing the call erases who was on it');

select * from finish();
rollback;
