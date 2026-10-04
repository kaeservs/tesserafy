-- Calendar sync (ADR 0021): a person's calendar is theirs alone; a sync
-- replaces their upcoming meetings, drops the ones that went away, keeps a
-- prep's link, and records a failure without losing what was there;
-- disconnecting takes everything it brought. Runs with `supabase test db`
-- (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('ca1e0001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('ca1e0001-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'ca1e0001-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000000a', 'ca1e0001-0000-4000-8000-000000000002');

create temporary table made (n int, id uuid);
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ca1e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.record_calendar_sync('google', '[]'::jsonb) $$, 'P0002', null, 'nothing syncs before a calendar is connected');
select public.connect_calendar('google', 'seller@acme.test', 'v1:a:b:c');

select is(public.record_calendar_sync('google', format('[
  {"external_id":"e1","title":"Northwind discovery","starts_at":"%s","ends_at":"%s","attendees":[{"email":"dana@northwind.test","name":"Dana"}],"meeting_url":"https://meet.google.com/abc"},
  {"external_id":"e2","title":"Globex demo","starts_at":"%s","ends_at":"%s","attendees":[],"meeting_url":"javascript:alert(1)"}
]', now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '2 days', now() + interval '2 days 1 hour')::jsonb), 2,
  'a sync records the upcoming meetings');
select is((select meeting_url from public.calendar_events where external_id = 'e2'), null, 'a meeting link that is not https is not kept');

-- A prep made from e1.
insert into made select 1, public.save_call_prep('Dana', p_call_at => now() + interval '1 day');
select public.link_calendar_event((select id from public.calendar_events where external_id = 'e1'), (select id from made where n = 1));

-- e2 was cancelled: the next sync no longer has it.
select public.record_calendar_sync('google', format('[
  {"external_id":"e1","title":"Northwind discovery (moved)","starts_at":"%s","ends_at":"%s","attendees":[{"email":"dana@northwind.test","name":"Dana"}]}
]', now() + interval '3 days', now() + interval '3 days 1 hour')::jsonb);
select is((select count(*)::int from public.calendar_events), 1, 'a meeting that went away is removed');
select is((select title from public.calendar_events where external_id = 'e1'), 'Northwind discovery (moved)', 'a moved meeting is updated');
select ok((select prep_id is not null from public.calendar_events where external_id = 'e1'), 'and keeps the prep made from it');

select public.record_calendar_sync('google', '[]'::jsonb, p_error => 'token revoked');
select is((select last_error from public.calendar_connections), 'token revoked', 'a failed sync says why');
select is((select count(*)::int from public.calendar_events), 1, 'without losing what was there');

select set_config('request.jwt.claims', '{"sub":"ca1e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.calendar_events) + (select count(*)::int from public.calendar_connections), 0,
  'a colleague reads none of it');
select throws_ok($$ select public.link_calendar_event((select id from public.calendar_events limit 1), gen_random_uuid()) $$, '42501', null,
  'nor links someone else''s meeting');

select set_config('request.jwt.claims', '{"sub":"ca1e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.disconnect_calendar('google');
select is((select count(*)::int from public.calendar_events) + (select count(*)::int from public.calendar_connections), 0,
  'disconnecting takes the connection and its meetings');

select * from finish();
rollback;
