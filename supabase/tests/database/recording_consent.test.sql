-- Recording consent: the caller supplies the words, the database supplies who
-- and when. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email, aud, role)
values ('88888888-8888-4888-8888-888888888888', 'consent-a@test.tesserafy.local',
        'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id)
values ('00000000-0000-4000-8000-00000000000a', '88888888-8888-4888-8888-888888888888');

create temporary table made (label text, id uuid) on commit drop;
grant all on made to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);

insert into made
select 'import', public.import_conversation(
  'Consent import', '[{"speaker":"customer","startMs":0,"endMs":1000,"text":"hello"}]'::jsonb,
  p_consent_statement => 'Everyone on this call was told it was recorded, and agreed.');

insert into made
select 'live', public.start_live_conversation(
  'Consent live', p_consent_statement => 'Everyone on this call has been told it is being recorded, and agreed.');

select throws_ok(
  $$ select public.start_live_conversation('No statement') $$,
  '22023', null,
  'a live call without a statement is refused'
);

select throws_ok(
  $$ select public.import_conversation(
       'No statement', '[{"speaker":"customer","startMs":0,"endMs":1000,"text":"hello"}]'::jsonb) $$,
  '22023', null,
  'and so is an import'
);

select throws_ok(
  $$ select public.start_live_conversation('   ', p_consent_statement => '   ') $$,
  '22023', null,
  'a blank statement is no statement'
);

reset role;

-- The operator path: pnpm ingest writes the table directly and records none.
insert into made (label, id)
values ('none', '99999999-0000-4000-8000-000000000001');
insert into public.conversations (id, company_id, title)
values ('99999999-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Operator import');

select is(
  (select consent_statement from public.conversations where id = (select id from made where label = 'import')),
  'Everyone on this call was told it was recorded, and agreed.',
  'an import keeps the statement verbatim'
);

select is(
  (select consent_confirmed_by from public.conversations where id = (select id from made where label = 'import')),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'and records who confirmed it from the session, not the request'
);

select ok(
  (select consent_confirmed_at is not null from public.conversations where id = (select id from made where label = 'import')),
  'and when'
);

select is(
  (select consent_confirmed_by from public.conversations where id = (select id from made where label = 'live')),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'a live call records who confirmed it too'
);

select ok(
  (select consent_statement is null and consent_confirmed_by is null and consent_confirmed_at is null
     from public.conversations where id = (select id from made where label = 'none')),
  'a call an operator imports records nothing rather than a guess'
);

select throws_ok(
  $$ update public.conversations set consent_confirmed_at = now()
      where id = (select id from made where label = 'none') $$,
  '23514', null,
  'a time without a statement is refused'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);

select is(
  (select consent_statement from public.conversations where id = (select id from made where label = 'live')),
  'Everyone on this call has been told it is being recorded, and agreed.',
  'a member can read the statement on their own call'
);

-- No update policy exists, so RLS makes this touch nothing rather than raise.
update public.conversations set consent_statement = 'edited'
 where id = (select id from made where label = 'live');

select is(
  (select consent_statement from public.conversations where id = (select id from made where label = 'live')),
  'Everyone on this call has been told it is being recorded, and agreed.',
  'and cannot rewrite it'
);

select * from finish();
rollback;
