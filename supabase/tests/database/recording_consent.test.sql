-- Recording consent: the caller supplies the words, the database supplies who
-- and when. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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

insert into made
select 'none', public.start_live_conversation('No statement');

reset role;

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
  'a call started without a statement records nothing rather than a guess'
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
