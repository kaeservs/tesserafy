-- A session that began inside a support window ends with it; the customer's
-- own session from before it does not; nor does one in an open window.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, aud, role) values
  ('5e000001-0000-4000-8000-000000000001', 'customer@acme.test', 'authenticated', 'authenticated'),
  ('5e000001-0000-4000-8000-000000000002', 'op@test.tesserafy.local', 'authenticated', 'authenticated');

-- The customer's own session, an hour before; the operator's, inside the window.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('5e000001-0000-4000-8000-0000000000a1', '5e000001-0000-4000-8000-000000000001', now() - interval '60 minutes', now()),
  ('5e000001-0000-4000-8000-0000000000a2', '5e000001-0000-4000-8000-000000000001', now() - interval '20 minutes', now());
insert into public.support_access (id, admin_user_id, subject_user_id, reason, expires_at, created_at)
values ('5e000001-0000-4000-8000-0000000000b1', '5e000001-0000-4000-8000-000000000002', '5e000001-0000-4000-8000-000000000001',
        'Investigating a ticket', now() + interval '10 minutes', now() - interval '25 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5e000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e000001-0000-4000-8000-0000000000a2"}', true);
select is(public.support_session_ended(), false, 'a session inside an open support window goes on');

reset role;
update public.support_access set ended_at = now() where id = '5e000001-0000-4000-8000-0000000000b1';
set local role authenticated;
select is(public.support_session_ended(), true, 'once the operator ends it, the session that began inside it is over');

select set_config('request.jwt.claims',
  '{"sub":"5e000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e000001-0000-4000-8000-0000000000a1"}', true);
select is(public.support_session_ended(), false, 'the customer''s own session from before the window is untouched');

reset role;
update public.support_access set ended_at = null, expires_at = now() - interval '1 minute' where id = '5e000001-0000-4000-8000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5e000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"5e000001-0000-4000-8000-0000000000a2"}', true);
select is(public.support_session_ended(), true, 'and a window that ran out ends it too, with nobody pressing anything');

select set_config('request.jwt.claims', '{"sub":"5e000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.support_session_ended(), false, 'a token naming no session is not a support session');

select * from finish();
rollback;
