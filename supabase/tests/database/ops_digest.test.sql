-- The alerting digest (ADR 0019): only an operator makes its token; only the
-- current token reads it, with the public key and no user; and it carries
-- counts and states, never a failure's message. Runs with `supabase test db`
-- (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role) values
  ('0b500000-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('0b500000-0000-4000-8000-000000000002', 'member@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('0b500000-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', '0b500000-0000-4000-8000-000000000002');

-- What happened in the window: one billing refusal, the same rejected request
-- twice (an alarm), and an overloaded model three times (weather).
insert into public.system_failures (source, kind, status, message, created_at) values
  ('api/ask', 'billing', 400, 'Your credit balance is too low — and a customer quote', now()),
  ('api/detect', 'model_rejected', 400, 'temperature is deprecated', now()),
  ('api/detect', 'model_rejected', 400, 'temperature is deprecated', now()),
  ('api/suggest', 'model_unavailable', 529, 'overloaded', now()),
  ('api/suggest', 'model_unavailable', 529, 'overloaded', now()),
  ('api/suggest', 'model_unavailable', 529, 'overloaded', now()),
  ('api/old', 'database', null, 'long ago', now() - interval '3 days');

create temporary table made (n int, token text);
create temporary table digest (d jsonb);
grant all on made, digest to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.admin_create_ops_token() $$, '42501', null, 'a customer cannot make the token');

select set_config('request.jwt.claims', '{"sub":"0b500000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select 1, public.admin_create_ops_token();
select matches((select token from made where n = 1), '^ops_[0-9a-f]{64}$', 'an operator can, and sees it once');
select is((public.admin_ops_token() ->> 'hint'), right((select token from made where n = 1), 4), 'the console shows only its last four');

-- The workflow: the public key and the token, no user.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.ops_digest('ops_wrong') $$, '42501', null, 'a wrong token reads nothing');

insert into digest select public.ops_digest((select token from made where n = 1), 4);
select is((select (d ->> 'alarming')::int from digest), 2, 'the rejected request twice is an alarm; the overload is not');
select is((select (d ->> 'billing')::boolean from digest), true, 'and the billing refusal is flagged');
select is(
  (select count(*)::int from digest, jsonb_array_elements(d -> 'failures') g where g ->> 'source' = 'api/old'),
  0, 'only the window is read'
);
select ok(
  (select d::text not like '%credit balance%' and d::text not like '%customer quote%' and d::text not like '%message%' from digest),
  'and no failure''s message is in it'
);
select ok((select d ? 'spend_usd' and d ? 'waiting' and d ? 'new_companies' from digest), 'it says what waits and what was spent');

-- A new token replaces the old one; revoking leaves none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b500000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select 2, public.admin_create_ops_token();
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format('select public.ops_digest(%L)', (select token from made where n = 1)), '42501', null, 'a replaced token reads nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b500000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.admin_revoke_ops_token();
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format('select public.ops_digest(%L)', (select token from made where n = 2)), '42501', null, 'nor a revoked one');

select * from finish();
rollback;
