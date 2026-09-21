-- Cost telemetry: kept for everyone, readable only by the company that spent
-- it. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, aud, role)
values ('55555555-5555-4555-8555-555555555555', 'spend-a@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.record_model_usage('t3', 'claude-opus-5', 5500, 1200, 300, 0, 800,
       't3-extract@test', '00000000-0000-4000-8000-00000000000a', null) $$,
  'a call is recorded against the company it was spent for'
);

-- A T1 detection knows a window, not a tenant. Those rows are most of the
-- live cost and must still be keepable.
select lives_ok(
  $$ select public.record_model_usage('t1', 'claude-haiku-4-5', 1400, 450, 120, 0, 0) $$,
  'a call with no company is still recorded'
);

select is(
  (select tier from public.model_usage where model = 'claude-haiku-4-5'),
  't1',
  'the tier is kept, so live and batch spend can be told apart'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);

select isnt_empty(
  $$ select 1 from public.model_usage where company_id = '00000000-0000-4000-8000-00000000000a' $$,
  'a member reads their own company''s spend'
);

-- Unattributed rows are operator data. Visible to every member would mean one
-- customer inferring another's volume from the totals.
select is_empty(
  $$ select 1 from public.model_usage where company_id is null $$,
  'rows with no company are invisible to members'
);

select throws_ok(
  $$ select public.record_model_usage('t3', 'claude-opus-5', 100, 1, 1, 0, 0, null,
       '00000000-0000-4000-8000-00000000000b', null) $$,
  '42501',
  null,
  'nobody can record spend against another company'
);

reset role;

select * from finish();
rollback;
