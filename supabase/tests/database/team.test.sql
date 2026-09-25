-- The team: who sees it, who may remove whom, and the record left behind.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email, aud, role) values
  ('bbbb0001-0000-4000-8000-000000000001', 'owner-one@acme.test', 'authenticated', 'authenticated'),
  ('bbbb0001-0000-4000-8000-000000000002', 'owner-two@acme.test', 'authenticated', 'authenticated'),
  ('bbbb0001-0000-4000-8000-000000000003', 'member@acme.test', 'authenticated', 'authenticated'),
  ('bbbb0001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'bbbb0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'bbbb0001-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'bbbb0001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'bbbb0001-0000-4000-8000-000000000004', 'owner');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Seeing the team
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"bbbb0001-0000-4000-8000-000000000003","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.company_team()),
  3,
  'a member sees everyone in their company'
);

select is(
  (select string_agg(email, ',' order by email) from public.company_team()),
  'member@acme.test,owner-one@acme.test,owner-two@acme.test',
  'with their addresses, and nobody from another company'
);

select is(
  (select email from public.company_team() where is_you),
  'member@acme.test',
  'and knows which one is them'
);

-- ---------------------------------------------------------------------------
-- Who may remove whom
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.remove_company_member('bbbb0001-0000-4000-8000-000000000001') $$,
  '42501', null,
  'a member cannot remove anyone'
);

select set_config('request.jwt.claims',
  '{"sub":"bbbb0001-0000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.remove_company_member('bbbb0001-0000-4000-8000-000000000001') $$,
  '22023', null,
  'an owner cannot remove themselves'
);

select throws_ok(
  $$ select public.remove_company_member('bbbb0001-0000-4000-8000-000000000004') $$,
  '22023', null,
  'nor anyone in another company'
);

select is(
  (select count(*)::integer from public.company_members
    where user_id = 'bbbb0001-0000-4000-8000-000000000004'),
  0,
  'which, from here, is not even visible'
);

select lives_ok(
  $$ select public.remove_company_member('bbbb0001-0000-4000-8000-000000000003') $$,
  'an owner removes a member'
);

select is(
  (select count(*)::integer from public.company_team()),
  2,
  'who is no longer on the team'
);

select is(
  (select email || '/' || role || '/' || removed_by::text from public.membership_removals),
  'member@acme.test/member/bbbb0001-0000-4000-8000-000000000001',
  'and the owner can read who was removed, as what, and by whom'
);

select lives_ok(
  $$ select public.remove_company_member('bbbb0001-0000-4000-8000-000000000002') $$,
  'an owner can remove a co-owner, which still leaves an owner'
);

-- ---------------------------------------------------------------------------
-- The person removed
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"bbbb0001-0000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.company_team() $$,
  '42501', null,
  'someone removed has no team to look at'
);

select is(
  (select count(*)::integer from public.conversations),
  0,
  'and no calls'
);

select * from finish();
rollback;
