-- A company's CRM (ADR 0024): only an owner connects it; members see which,
-- never the ciphertext; the one path to it is a call of their own company,
-- not from a support session; a call's note is one row, updated when logged
-- again; another company sees none of it; closing the company forgets the
-- CRM and erasing a call its log. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('c4e00000-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('c4e00000-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('c4e00000-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated'),
  ('c4e00000-0000-4000-8000-000000000004', 'op@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'c4e00000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'c4e00000-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'c4e00000-0000-4000-8000-000000000003', 'owner');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"c4e00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.connect_crm('hubspot', '12345678', 'v1:a:b:c', 'wxyz') $$, '42501', null,
  'a member who is not an owner cannot connect a CRM');
select is((select count(*)::int from public.crm_for_call('00000000-0000-4000-8000-0000000000a1')), 0,
  'with none connected, a call has no CRM');

select set_config('request.jwt.claims', '{"sub":"c4e00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.connect_crm('hubspot', '12345678', 'v1:a:b:c', 'wxyz') $$, 'an owner connects one');
select throws_ok($$ select public.connect_crm('hubspot', 'not-a-portal', 'v1:a:b:c', 'wxyz') $$, '23514', null,
  'an account id that is not one is refused');

select set_config('request.jwt.claims', '{"sub":"c4e00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select account_ref from public.company_crms), '12345678', 'members see which CRM it is');
select throws_ok($$ select token_ciphertext from public.company_crms $$, '42501', null, 'but never the ciphertext');
select is((select token_ciphertext from public.crm_for_call('00000000-0000-4000-8000-0000000000a1')), 'v1:a:b:c',
  'which comes back only for a call of their own company');

select public.record_crm_log('00000000-0000-4000-8000-0000000000a1', 'hubspot', '1001', '501', 'Northwind', 2);
select public.record_crm_log('00000000-0000-4000-8000-0000000000a1', 'hubspot', '1001', '501', 'Northwind', 3);
select is((select count(*)::int || ':' || max(contacts) from public.crm_logs), '1:3', 'logging a call again updates its one note');

select set_config('request.jwt.claims', '{"sub":"c4e00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.crm_for_call('00000000-0000-4000-8000-0000000000a1') $$, 'P0002', null,
  'another company cannot reach the CRM through a call that is not theirs');
select is((select count(*)::int from public.company_crms) + (select count(*)::int from public.crm_logs), 0,
  'and sees none of it');

-- An operator's support session for the seller.
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('c4e00000-0000-4000-8000-0000000000a1', 'c4e00000-0000-4000-8000-000000000002', now() - interval '5 minutes', now());
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at, created_at)
values ('c4e00000-0000-4000-8000-000000000004', 'c4e00000-0000-4000-8000-000000000002', 'Investigating a ticket',
        now() + interval '25 minutes', now() - interval '10 minutes');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c4e00000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c4e00000-0000-4000-8000-0000000000a1"}', true);
select throws_ok($$ select * from public.crm_for_call('00000000-0000-4000-8000-0000000000a1') $$, '42501', null,
  'a support session does not write to the customer''s CRM');

reset role;
delete from public.conversations where id = '00000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.crm_logs), 0, 'erasing a call erases its log');

update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.company_crms), 0, 'closing the company forgets its CRM');
select is((select string_agg(action, ',' order by at, action) from public.crm_events), 'connected,disconnected',
  'and the CRM log says so');

select * from finish();
rollback;
