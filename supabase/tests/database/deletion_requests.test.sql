-- "Delete my account": who may ask, what asking does at once, and that the
-- operator's deletion resolves the request. Runs with `supabase test db`
-- (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('de1e0001-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('de1e0001-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('de1e0001-0000-4000-8000-000000000003', 'Member@Acme.test', 'authenticated', 'authenticated'),
  ('de1e0001-0000-4000-8000-000000000004', 'loner@nowhere.test', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('de1e0001-0000-4000-8000-000000000001', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'de1e0001-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'de1e0001-0000-4000-8000-000000000003', 'member');

create temporary table made (label text, id uuid) on commit drop;
grant all on made to authenticated;

set local role authenticated;

select throws_ok(
  $$ select public.request_account_deletion('member@acme.test') $$,
  '42501', null,
  'nobody signed in cannot ask'
);

-- ---------------------------------------------------------------------------
-- Who is refused
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_like(
  $$ select public.request_account_deletion('owner@acme.test') $$,
  '%an owner cannot leave%',
  'an owner cannot, while the company exists'
);

select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_like(
  $$ select public.request_account_deletion('operator@test.tesserafy.local') $$,
  '%another operator%',
  'nor an operator'
);

select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.request_account_deletion('someone-else@acme.test') $$,
  '22023', null,
  'the address typed must be the caller''s own'
);

-- ---------------------------------------------------------------------------
-- A member asks
-- ---------------------------------------------------------------------------
insert into made select 'request', (public.request_account_deletion('  member@ACME.test ')).id;

select is(
  (select count(*)::integer from public.company_members where user_id = 'de1e0001-0000-4000-8000-000000000003'),
  0,
  'asking takes them out of their company at once'
);
select is(
  (select company_id from public.account_deletion_requests where id = (select id from made where label = 'request')),
  '00000000-0000-4000-8000-00000000000a'::uuid,
  'and the request says which company they left'
);
select is(
  (public.request_account_deletion('member@acme.test')).id,
  (select id from made where label = 'request'),
  'asking again returns the same request'
);
select is(
  (select count(*)::integer from public.account_deletion_requests),
  1,
  'they can read their own request'
);

select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.account_deletion_requests),
  0,
  'their owner cannot read it'
);
select is(
  (select removed_by from public.membership_removals where user_id = 'de1e0001-0000-4000-8000-000000000003'),
  'de1e0001-0000-4000-8000-000000000003'::uuid,
  'but sees in the removal log that they left, by their own hand'
);

-- Someone in no company can ask too.
select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (public.request_account_deletion('loner@nowhere.test')).company_id,
  null,
  'someone in no company can ask'
);

-- ---------------------------------------------------------------------------
-- The operator deletes the account, and the request resolves
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"de1e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.account_deletion_requests where resolved_at is null),
  2,
  'operators see every open request'
);

insert into made select 'deletion', (public.open_account_deletion(
  'de1e0001-0000-4000-8000-000000000003', 'the account holder asked')).id;
select is(
  (select resolved_at from public.account_deletion_requests where id = (select id from made where label = 'request')),
  null,
  'opening a deletion does not resolve the request'
);

reset role;
delete from auth.users where id = 'de1e0001-0000-4000-8000-000000000003';
set local role authenticated;

select lives_ok(
  $$ select public.complete_account_deletion((select id from made where label = 'deletion')) $$,
  'the operator completes the deletion'
);
select is(
  (select deletion_id from public.account_deletion_requests where id = (select id from made where label = 'request')),
  (select id from made where label = 'deletion'),
  'which resolves the request, naming the deletion'
);
select is(
  (select count(*)::integer from public.account_deletion_requests where resolved_at is null),
  1,
  'and leaves the other request open'
);

select * from finish();
rollback;
