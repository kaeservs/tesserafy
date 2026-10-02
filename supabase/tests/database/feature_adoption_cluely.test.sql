-- The console's adoption counts the Cluely-style features (2026-10): live
-- calls, the overlay's help, questions, follow-ups, action items, knowledge
-- and recording agreements — for operators only. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, aud, role) values
  ('fa000001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('fa000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('fa000001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'fa000001-0000-4000-8000-000000000002');

-- Company A: one live call, two presses of the overlay's help, one agreement.
insert into public.conversations (id, company_id, title, captured_live) values
  ('fa000001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Live', true);
insert into public.model_usage (company_id, tier, model, detector, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, duration_ms) values
  ('00000000-0000-4000-8000-00000000000a', 't2', 'claude-sonnet-5', 't2-assist@2026-10-09', 10, 5, 0, 0, 100),
  ('00000000-0000-4000-8000-00000000000a', 't2', 'claude-sonnet-5', 't2-assist@2026-10-09', 10, 5, 0, 0, 100);
insert into public.recording_agreements (user_id, email, company_id, terms_version, statement, surface) values
  ('fa000001-0000-4000-8000-000000000002', 'seller@acme.test', '00000000-0000-4000-8000-00000000000a', 'test', 'I will tell everyone on every call I record.', 'overlay');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.admin_feature_adoption(30) $$, '42501', null, 'a customer cannot read adoption');

select set_config('request.jwt.claims', '{"sub":"fa000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select live_calls::int from public.admin_feature_adoption(30) where company_id = '00000000-0000-4000-8000-00000000000a'),
  1, 'an operator sees a company''s live calls'
);
select is(
  (select overlay_help::int from public.admin_feature_adoption(30) where company_id = '00000000-0000-4000-8000-00000000000a'),
  2, 'and how often it asked the overlay for help'
);
select is(
  (select agreed::int from public.admin_feature_adoption(30) where company_id = '00000000-0000-4000-8000-00000000000a'),
  1, 'and how many of its people agreed to record'
);

select * from finish();
rollback;
