-- What the AI is told about a company: a correction becomes an example the
-- moment it is made and goes when it is withdrawn; owners write, switch off
-- and delete guidance, members only read it; call types and the default
-- scorecard are owners'; and none of it crosses a tenant.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role) values
  ('a1d00001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('a1d00001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('a1d00001-0000-4000-8000-000000000003', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'a1d00001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'a1d00001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'a1d00001-0000-4000-8000-000000000003', 'owner');
insert into public.conversations (id, company_id, title, added_by)
values ('a1d00001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Call', 'a1d00001-0000-4000-8000-000000000002');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('a1d00001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a', 'a1d00001-0000-4000-8000-0000000000c1',
        'customer', 0, 4000, 'Headcount for this is already approved.');

create temporary table made (label text, id uuid);
grant all on made to authenticated;
set local role authenticated;

-- A correction teaches, as it is made.
select set_config('request.jwt.claims', '{"sub":"a1d00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into made select 'correction', public.dispute_criterion('a1d00001-0000-4000-8000-0000000000c1', 'budget_indicated',
  'evidence', 'a1d00001-0000-4000-8000-0000000000d1', 'Headcount for this is already approved', 'Approved headcount is budget for us.');
select results_eq(
  $$ select kind, criterion_key, quote, counts, body, engagement_type from public.ai_guidance $$,
  $$ values ('example'::text, 'budget_indicated'::text, 'Headcount for this is already approved'::text, true,
             'Approved headcount is budget for us.'::text, 'discovery'::text) $$,
  'a correction becomes an example of what counts, with its reason, for that scorecard'
);

-- Members read it; only owners write, switch off or delete.
select throws_ok($$ select public.add_ai_instruction('prep', 'Lead with ROI.') $$, '42501', null, 'a member cannot instruct the AI');
select throws_ok(
  $$ select public.set_ai_guidance((select id from public.ai_guidance limit 1), false) $$,
  '42501', null, 'nor switch off what it learned'
);

select set_config('request.jwt.claims', '{"sub":"a1d00001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.add_ai_instruction('email', 'x') $$, '22023', null, 'there is no such feature');
select throws_ok($$ select public.add_ai_instruction('prep', 'x', null, 'budget_indicated') $$, '22023', null,
  'only scoring is told about a criterion');
insert into made select 'instruction', public.add_ai_instruction('action_items', 'On sales calls, say who owns each step and by when.', 'discovery');
select is((select count(*)::int from public.ai_guidance where kind = 'instruction'), 1, 'an owner instructs one feature for one call type');
select lives_ok($$ select public.set_ai_guidance((select id from made where label = 'instruction'), false) $$, 'and switches it off');
select is((select active from public.ai_guidance where id = (select id from made where label = 'instruction')), false, 'it is off');
select lives_ok($$ select public.set_ai_guidance((select id from made where label = 'instruction'), null, true) $$, 'and deletes it');

-- Call types.
select lives_ok($$ select public.set_call_type('discovery', 'sales', true) $$, 'an owner says discovery calls are sales calls, and the default');
select is((select purpose from public.scorecard_purposes), 'sales', 'the call type is stored');
select throws_ok($$ select public.set_call_type('discovery', 'gossip') $$, '22023', null, 'from the list only');

select set_config('request.jwt.claims', '{"sub":"a1d00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_call_type('discovery', 'support') $$, '42501', null, 'a member cannot set call types');

select set_config('request.jwt.claims', '{"sub":"a1d00001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.ai_guidance), 0, 'another company reads none of it');

-- Withdrawing the correction takes the example with it.
select set_config('request.jwt.claims', '{"sub":"a1d00001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.withdraw_dispute((select id from made where label = 'correction')) $$, 'the correction is withdrawn');
select is((select count(*)::int from public.ai_guidance), 0, 'and what it taught is forgotten');

select * from finish();
rollback;
