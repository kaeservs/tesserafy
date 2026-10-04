-- Sending a follow-up (ADR 0023): only after a draft, to one to ten real
-- addresses, recorded before it leaves and settled once by its sender; read by
-- the company and no one else; never from a support session; at most thirty
-- an hour a company; gone with the call. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('f5e00000-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('f5e00000-0000-4000-8000-000000000002', 'colleague@acme.test', 'authenticated', 'authenticated'),
  ('f5e00000-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('f5e00000-0000-4000-8000-000000000004', 'op@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'f5e00000-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'f5e00000-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'f5e00000-0000-4000-8000-000000000003', 'owner');

create temporary table sent (n int, result jsonb);
grant all on sent to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f5e00000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.begin_follow_up_send('00000000-0000-4000-8000-0000000000a1', 'Sam', array['dana@northwind.test'], 'Hi', 'Body') $$,
  'P0002', null, 'nothing is sent before there is a draft');

select public.record_follow_up('00000000-0000-4000-8000-0000000000a1', 't3-follow-up@test', 'claude-sonnet-5',
  '{"subject":"Following up","greeting":"Hi Dana,","opening":"Thanks.","closing":"Best,","lines":[]}'::jsonb);

select throws_ok($$ select public.begin_follow_up_send('00000000-0000-4000-8000-0000000000a1', 'Sam', array['not an address'], 'Hi', 'Body') $$,
  '22023', null, 'an address that is not one is refused');
select throws_ok($$ select public.begin_follow_up_send('00000000-0000-4000-8000-0000000000a1', 'Sam <x@y.z>', array['dana@northwind.test'], 'Hi', 'Body') $$,
  '23514', null, 'a name that would forge a sender is refused');

insert into sent select 1, public.begin_follow_up_send('00000000-0000-4000-8000-0000000000a1', 'Sam Seller',
  array['Dana@Northwind.test ', 'dana@northwind.test', 'lee@northwind.test'], 'Following up', 'Hi Dana, thanks.');
select is((select result ->> 'reply_to' from sent where n = 1), 'seller@acme.test', 'replies go to the sender''s own address');
select is((select recipients from public.follow_up_sends), array['dana@northwind.test', 'lee@northwind.test'],
  'recipients are kept once each, as addresses compare');

select set_config('request.jwt.claims', '{"sub":"f5e00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.finish_follow_up_send(%L, 'msg_1') $$, (select result ->> 'id' from sent where n = 1)),
  'P0002', null, 'a colleague does not settle someone else''s send');
select is((select count(*)::int from public.follow_up_sends), 1, 'but reads it, as the company''s');

select set_config('request.jwt.claims', '{"sub":"f5e00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.finish_follow_up_send((select (result ->> 'id')::uuid from sent where n = 1), 'msg_1');
select is((select status from public.follow_up_sends), 'sent', 'the sender settles it as sent');
select throws_ok(format($$ select public.finish_follow_up_send(%L, null, 'again') $$, (select result ->> 'id' from sent where n = 1)),
  'P0002', null, 'and only once');

select set_config('request.jwt.claims', '{"sub":"f5e00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.follow_up_sends), 0, 'another company reads none of it');

-- An operator's support session for the seller.
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('f5e00000-0000-4000-8000-0000000000a1', 'f5e00000-0000-4000-8000-000000000001', now() - interval '5 minutes', now());
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at, created_at)
values ('f5e00000-0000-4000-8000-000000000004', 'f5e00000-0000-4000-8000-000000000001', 'Investigating a ticket',
        now() + interval '25 minutes', now() - interval '10 minutes');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f5e00000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f5e00000-0000-4000-8000-0000000000a1"}', true);
select throws_ok($$ select public.begin_follow_up_send('00000000-0000-4000-8000-0000000000a1', 'Sam', array['dana@northwind.test'], 'Hi', 'Body') $$,
  '42501', null, 'a support session does not send in the customer''s name');

reset role;
delete from public.conversations where id = '00000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.follow_up_sends), 0, 'erasing the call erases what was sent from it');

select * from finish();
rollback;
