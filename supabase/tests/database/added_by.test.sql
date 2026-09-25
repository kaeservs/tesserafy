-- Who added a call: taken from the session by both front doors.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, aud, role) values
  ('afaf0001-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('afaf0001-0000-4000-8000-000000000002', 'other@acme.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'afaf0001-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'afaf0001-0000-4000-8000-000000000002', 'member');

create temporary table made (label text, id uuid) on commit drop;
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"afaf0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into made select 'import', public.import_conversation(
  'Imported call', '[{"speaker":"customer","startMs":0,"endMs":1000,"text":"hello"}]'::jsonb,
  p_consent_statement => 'Everyone agreed.');
insert into made select 'live', public.start_live_conversation(
  'Live call', p_consent_statement => 'Everyone agreed.');

select is(
  (select added_by from public.conversations where id = (select id from made where label = 'import')),
  'afaf0001-0000-4000-8000-000000000001'::uuid,
  'an imported call belongs to the account that imported it'
);
select is(
  (select added_by from public.conversations where id = (select id from made where label = 'live')),
  'afaf0001-0000-4000-8000-000000000001'::uuid,
  'and a live one to the account that recorded it'
);

-- A colleague in the same company reads who added it, as the report needs.
select set_config('request.jwt.claims',
  '{"sub":"afaf0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.conversations
    where added_by = 'afaf0001-0000-4000-8000-000000000001'),
  2,
  'a colleague sees who added each call in their company'
);

-- The caller cannot say it was someone else: there is no argument to say it with.
select throws_ok(
  $$ select public.import_conversation(
       'Claimed call', '[{"speaker":"customer","startMs":0,"endMs":1000,"text":"hi"}]'::jsonb,
       p_consent_statement => 'Everyone agreed.', p_added_by => 'afaf0001-0000-4000-8000-000000000001') $$,
  '42883', null,
  'and nobody can attribute a call to someone else'
);

select * from finish();
rollback;
