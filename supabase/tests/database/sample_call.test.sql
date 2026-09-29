-- The sample call: once per company, ever, whoever asks and however; marked
-- as a sample; and honest about consent. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, aud, role) values
  ('5a3e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('5a3e0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('5a3e0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5a3e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '5a3e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '5a3e0001-0000-4000-8000-000000000003', 'owner');

create temporary table made (label text, id uuid);
grant all on made to authenticated;

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into made select 'acme', public.import_sample_call(
  'Sample call', '[{"speaker":"Maya","startMs":0,"endMs":4000,"text":"How does reporting work today?"}]'::jsonb);
select ok((select id from made where label = 'acme') is not null, 'any member can import the sample');
select is(
  (select is_sample from public.conversations where id = (select id from made where label = 'acme')),
  true, 'and it is marked as the sample'
);
select matches(
  (select consent_statement from public.conversations where id = (select id from made where label = 'acme')),
  '^A sample call written by Tesserafy',
  'it says nobody was recorded, rather than that everyone agreed'
);
select is(
  (select added_by from public.conversations where id = (select id from made where label = 'acme')),
  '5a3e0001-0000-4000-8000-000000000002'::uuid,
  'and who added it'
);

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Again"}]'::jsonb) $$,
  '23505', null, 'a second one for the same company is refused, whoever asks'
);

-- Deleting it does not bring the offer back.
reset role;
delete from public.conversations where id = (select id from made where label = 'acme');
set local role authenticated;
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Again"}]'::jsonb) $$,
  '23505', null, 'nor after the first is deleted'
);

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into made select 'globex', public.import_sample_call(
  'Sample call', '[{"speaker":"Maya","startMs":0,"endMs":4000,"text":"How does reporting work today?"}]'::jsonb);
select ok((select id from made where label = 'globex') is not null, 'another company has its own');
select is((select count(*)::int from public.conversations where is_sample), 1, 'and sees only its own');

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000009","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Hi"}]'::jsonb) $$,
  '42501', null, 'someone in no company cannot'
);

select * from finish();
rollback;
