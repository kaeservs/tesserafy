-- Deleting an account: who may, whose, what is refused, that the record is
-- written first and closed only once the account is gone, and that the audit
-- trail outlives it. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email, aud, role) values
  ('ade10001-0000-4000-8000-000000000001', 'operator-one@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('ade10001-0000-4000-8000-000000000002', 'operator-two@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('ade10001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated'),
  ('ade10001-0000-4000-8000-000000000004', 'Leaver@Acme.test', 'authenticated', 'authenticated'),
  ('ade10001-0000-4000-8000-000000000005', 'watched@acme.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('ade10001-0000-4000-8000-000000000001', 'test operator one'),
  ('ade10001-0000-4000-8000-000000000002', 'test operator two');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'ade10001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'ade10001-0000-4000-8000-000000000004', 'member');

create temporary table made (label text, id uuid) on commit drop;
grant all on made to authenticated;

-- The leaver adds a call while still a member, so the account is referenced
-- the way real accounts are: who added it, who confirmed consent.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000004","role":"authenticated"}', true);
insert into made select 'call', public.import_conversation(
  'Leaver call', '[{"speaker":"customer","startMs":0,"endMs":1000,"text":"hello"}]'::jsonb,
  p_consent_statement => 'Everyone agreed.');
reset role;
select set_config('request.jwt.claims', '', true);

-- Then leaves the company; staff had opened their account once, and another
-- account has a session open on it right now.
delete from public.company_members where user_id = 'ade10001-0000-4000-8000-000000000004';
insert into public.support_access (admin_user_id, subject_user_id, reason, expires_at, ended_at) values
  ('ade10001-0000-4000-8000-000000000001', 'ade10001-0000-4000-8000-000000000004', 'ticket 12', now() - interval '1 day', now() - interval '1 day'),
  ('ade10001-0000-4000-8000-000000000001', 'ade10001-0000-4000-8000-000000000005', 'ticket 13', now() + interval '1 hour', null);

-- ---------------------------------------------------------------------------
-- The guard: nothing outside Auth can stop an account being deleted
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(string_agg(c.conrelid::regclass::text || '.' || c.conname, ', '), '')
     from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and c.connamespace <> 'auth'::regnamespace
      and c.confdeltype not in ('c', 'n')),
  '',
  'every reference to an account outside Auth cascades or is set to null'
);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- A customer cannot
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000004', 'cleanup') $$,
  '42501', null,
  'a customer cannot delete an account'
);

-- ---------------------------------------------------------------------------
-- An operator, and what is refused
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000004', '  ') $$,
  '22023', null,
  'a reason is required'
);
select throws_ok(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000001', 'tidy') $$,
  '22023', null,
  'an operator cannot delete their own account'
);
select throws_ok(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000002', 'tidy') $$,
  '22023', null,
  'nor another operator''s'
);
select throws_like(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000003', 'tidy') $$,
  '%must leave it first%',
  'nor someone still in a company'
);
select throws_like(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-000000000005', 'tidy') $$,
  '%support session is open%',
  'nor an account a support session is open on'
);
select throws_ok(
  $$ select public.open_account_deletion('ade10001-0000-4000-8000-0000000000ff', 'tidy') $$,
  '22023', null,
  'nor an account that does not exist'
);

insert into made select 'deletion', (public.open_account_deletion(
  'ade10001-0000-4000-8000-000000000004', 'erasure request, ticket 14')).id;

select is(
  (select email_sha256 from public.account_deletions where id = (select id from made where label = 'deletion')),
  encode(sha256(convert_to('leaver@acme.test', 'UTF8')), 'hex'),
  'the record keeps a hash of the lower-cased address, not the address'
);

select throws_ok(
  $$ select public.complete_account_deletion((select id from made where label = 'deletion')) $$,
  '22023', null,
  'it cannot be closed while the account still exists'
);

-- ---------------------------------------------------------------------------
-- Auth deletes the account (what the console's key does)
-- ---------------------------------------------------------------------------
reset role;
select lives_ok(
  $$ delete from auth.users where id = 'ade10001-0000-4000-8000-000000000004' $$,
  'Auth can delete an account that staff opened and that added a call'
);
select is(
  (select count(*)::integer from public.support_access
    where subject_user_id = 'ade10001-0000-4000-8000-000000000004'),
  1,
  'the record that staff opened the account survives it, still naming the account'
);
select is(
  (select added_by from public.conversations where id = (select id from made where label = 'call')),
  null,
  'the call stays with the company, no longer attributed'
);
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.complete_account_deletion((select id from made where label = 'deletion')) $$,
  '42501', null,
  'only the operator who opened a deletion can close it'
);

select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select isnt(
  (public.complete_account_deletion((select id from made where label = 'deletion'))).completed_at,
  null,
  'once the account is gone, its operator closes the record'
);
select throws_ok(
  $$ select public.complete_account_deletion((select id from made where label = 'deletion')) $$,
  '42501', null,
  'and it closes once'
);
select throws_ok(
  $$ select public.open_support_access('ade10001-0000-4000-8000-000000000004', 'look') $$,
  '22023', null,
  'a deleted account cannot have a session opened on it'
);
select is(
  (select count(*)::integer from public.account_deletions),
  1,
  'operators read the deletion log'
);

select set_config('request.jwt.claims',
  '{"sub":"ade10001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.account_deletions),
  0,
  'customers do not'
);

select * from finish();
rollback;
