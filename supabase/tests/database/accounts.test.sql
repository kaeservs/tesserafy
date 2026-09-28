-- Customer accounts: any member names one (once, whatever the case), a call
-- points at one of its own company's, renaming and deleting are restricted,
-- deleting unlinks calls without touching them, every link is logged, and
-- closing a company forgets its customers.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, aud, role) values
  ('acc00001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('acc00001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('acc00001-0000-4000-8000-000000000003', 'other@acme.test', 'authenticated', 'authenticated'),
  ('acc00001-0000-4000-8000-000000000004', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'acc00001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'acc00001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'acc00001-0000-4000-8000-000000000003', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'acc00001-0000-4000-8000-000000000004', 'owner');
insert into public.conversations (id, company_id, title, added_by)
values ('acc00001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Acme discovery',
        'acc00001-0000-4000-8000-000000000002');

create temporary table made (label text, id uuid);
grant all on made to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Naming an account
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into made select 'northwind', public.save_account('  Northwind   Freight ', 'northwind.example');
select is(
  (select name || ' ' || domain from public.accounts where id = (select id from made where label = 'northwind')),
  'Northwind Freight northwind.example',
  'any member names an account, tidied'
);
select is(
  public.save_account('NORTHWIND FREIGHT'),
  (select id from made where label = 'northwind'),
  'the same name in another case is the same account'
);
select throws_ok($$ select public.save_account('   ') $$, '22023', null, 'an account has a name');
select throws_ok($$ select public.save_account('Bad Domain', 'not a domain') $$, '23514', null, 'a domain looks like one');

select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000004","role":"authenticated"}', true);
insert into made select 'globex-northwind', public.save_account('Northwind Freight');
select isnt(
  (select id from made where label = 'globex-northwind'),
  (select id from made where label = 'northwind'),
  'another company''s account of the same name is its own'
);
select is(
  (select count(*)::integer from public.accounts where name = 'Northwind Freight'),
  1,
  'and neither sees the other''s'
);

-- ---------------------------------------------------------------------------
-- A call's account
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.edit_conversation('acc00001-0000-4000-8000-0000000000c1', p_account_id => %L) $$,
         (select id from made where label = 'globex-northwind')),
  '22023', null,
  'a call cannot point at another company''s account'
);
select is(
  public.edit_conversation('acc00001-0000-4000-8000-0000000000c1', p_account_id => (select id from made where label = 'northwind')),
  '{"changed": ["account"], "evidence_removed": 0}'::jsonb,
  'whoever added a call says who it was with'
);
select is(
  (select new_value from public.conversation_edits where field = 'account'),
  'Northwind Freight',
  'and the change is logged by name'
);

-- ---------------------------------------------------------------------------
-- Renaming and deleting
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  format($$ select public.rename_account(%L, 'Northwind') $$, (select id from made where label = 'northwind')),
  '42501', null,
  'a member who did not add it cannot rename it'
);
select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.rename_account(%L, 'Northwind Freight Ltd', 'northwind.example') $$, (select id from made where label = 'northwind')),
  'whoever added it can'
);
insert into made select 'acme', public.save_account('Acme Robotics');
select throws_ok(
  format($$ select public.rename_account(%L, 'acme robotics') $$, (select id from made where label = 'northwind')),
  '23505', null,
  'not onto another account''s name'
);
select throws_ok(
  format($$ select public.delete_account(%L) $$, (select id from made where label = 'northwind')),
  '42501', null,
  'only an owner deletes an account'
);

select set_config('request.jwt.claims',
  '{"sub":"acc00001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.delete_account(%L) $$, (select id from made where label = 'northwind')),
  'an owner does'
);
select is(
  (select coalesce(account_id::text, 'unlinked') || ' / ' || company_id::text
     from public.conversations where id = 'acc00001-0000-4000-8000-0000000000c1'),
  'unlinked / 00000000-0000-4000-8000-00000000000a',
  'and its calls stay, unlinked, in their company'
);

-- ---------------------------------------------------------------------------
-- Closing forgets them
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::integer from public.accounts where company_id = '00000000-0000-4000-8000-00000000000a'), 1, 'Acme is still there');
update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::integer from public.accounts where company_id = '00000000-0000-4000-8000-00000000000a'),
  0,
  'closing the company forgets its customers'
);

select * from finish();
rollback;
