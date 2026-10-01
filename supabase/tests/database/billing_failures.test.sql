-- A failure can be recorded as billing — the model provider refusing us for
-- money — and nothing that is not a kind is accepted. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

insert into auth.users (id, email, aud, role) values
  ('b1110000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', 'b1110000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.record_failure('api/ask', 'billing', 'Your credit balance is too low', p_status => 400) $$,
  'running out of credit is recorded as billing'
);
select throws_ok(
  $$ select public.record_failure('api/ask', 'broke', 'x') $$,
  '23514', null, 'and a kind that is not one is refused'
);

select * from finish();
rollback;
