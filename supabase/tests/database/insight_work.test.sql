-- Working an insight: any member renames, assigns and comments; an owner
-- merges duplicates; every change is logged; assigning tells the assignee;
-- a merge keeps every citation and refuses to strand a ticket.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('1a5e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('1a5e0001-0000-4000-8000-000000000002', 'pm@acme.test', 'authenticated', 'authenticated'),
  ('1a5e0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '1a5e0001-0000-4000-8000-000000000003', 'owner');

insert into public.conversations (id, company_id, title)
values ('1a5e0001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'A call');
insert into public.signals (id, company_id, conversation_id, kind, summary, confidence, detector, model) values
  ('1a5e0001-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000c1', 'problem', 'Exports take a day', 0.9, 't', 'm'),
  ('1a5e0001-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000c1', 'problem', 'Reporting is manual', 0.9, 't', 'm'),
  ('1a5e0001-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000c1', 'problem', 'Fridays lost', 0.9, 't', 'm');
insert into public.insights (id, company_id, title, summary, synthesiser, model) values
  ('1a5e0001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Exports are slow', 'Several say so.', 's', 'm'),
  ('1a5e0001-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'Reporting takes a day', 'The same thing.', 's', 'm'),
  ('1a5e0001-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-00000000000a', 'Ticketed already', 'It went to GitHub.', 's', 'm');
insert into public.insight_evidence (company_id, insight_id, signal_id) values
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000a2', '1a5e0001-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000a2', '1a5e0001-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000a3', '1a5e0001-0000-4000-8000-0000000000e3');
update public.insights set status = 'approved', decided_by = '1a5e0001-0000-4000-8000-000000000001', decided_at = now()
 where id = '1a5e0001-0000-4000-8000-0000000000a3';
insert into public.insight_tickets (company_id, insight_id, provider, external_id, url, created_by)
values ('00000000-0000-4000-8000-00000000000a', '1a5e0001-0000-4000-8000-0000000000a3', 'github', '9',
        'https://github.com/acme/product/issues/9', '1a5e0001-0000-4000-8000-000000000001');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Any member: rename, assign, comment
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"1a5e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.edit_insight('1a5e0001-0000-4000-8000-0000000000a1', 'Weekly exports take most of a day', 'Several customers lose Fridays to it.') $$,
  'a member tightens an insight''s title and summary'
);
select throws_ok(
  $$ select public.edit_insight('1a5e0001-0000-4000-8000-0000000000a1', '  ', 'x') $$,
  '22023', null, 'an insight keeps a title'
);
select lives_ok(
  $$ select public.assign_insight('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-000000000001') $$,
  'and assigns it to the owner'
);
select throws_ok(
  $$ select public.assign_insight('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-000000000003') $$,
  '22023', null, 'never to someone outside the company'
);
select lives_ok(
  $$ select public.comment_insight('1a5e0001-0000-4000-8000-0000000000a2', 'Same as the exports one, I think.') $$,
  'and comments on another'
);

select set_config('request.jwt.claims',
  '{"sub":"1a5e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.notifications where kind = 'insight_assigned' and insight_id = '1a5e0001-0000-4000-8000-0000000000a1'),
  1,
  'the assignee is told'
);

-- ---------------------------------------------------------------------------
-- An owner merges
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"1a5e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.merge_insights('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-0000000000a2') $$,
  '42501', null, 'a member cannot merge'
);

select set_config('request.jwt.claims',
  '{"sub":"1a5e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.merge_insights('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-0000000000a3') $$,
  '22023', null, 'a ticketed insight is not merged away — its ticket would lead nowhere'
);
select throws_ok(
  $$ select public.merge_insights('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-0000000000a1') $$,
  '22023', null, 'nor into itself'
);
select is(
  public.merge_insights('1a5e0001-0000-4000-8000-0000000000a1', '1a5e0001-0000-4000-8000-0000000000a2'),
  1,
  'an owner merges the duplicate: one citation it did not already have'
);
select results_eq(
  $$ select signal_id from public.insight_evidence where insight_id = '1a5e0001-0000-4000-8000-0000000000a1' order by signal_id $$,
  $$ values ('1a5e0001-0000-4000-8000-0000000000e1'::uuid), ('1a5e0001-0000-4000-8000-0000000000e2'::uuid) $$,
  'the kept insight cites every signal either did, once'
);
select is(
  (select count(*)::integer from public.insights where id = '1a5e0001-0000-4000-8000-0000000000a2'),
  0,
  'the duplicate is gone'
);
select is(
  (select count(*)::integer from public.insight_comments where insight_id = '1a5e0001-0000-4000-8000-0000000000a1'),
  1,
  'and its discussion came with it'
);
select results_eq(
  $$ select kind from public.insight_events where insight_id = '1a5e0001-0000-4000-8000-0000000000a1' order by kind $$,
  $$ values ('assigned'::text), ('merged'), ('renamed') $$,
  'every change is on the record'
);

-- ---------------------------------------------------------------------------
-- Another company
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"1a5e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.comment_insight('1a5e0001-0000-4000-8000-0000000000a1', 'hello from outside') $$,
  'P0002', null, 'another company cannot even find it'
);
select is((select count(*)::integer from public.insight_comments), 0, 'or read its discussion');

select * from finish();
rollback;
