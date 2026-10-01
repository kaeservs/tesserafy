-- Follow-up drafts: every line quotes its segment or is not stored; one draft
-- a call; another company neither reads nor writes one; erasing the call
-- erases its draft. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, aud, role) values
  ('f0110000-0000-4000-8000-000000000001', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('f0110000-0000-4000-8000-000000000002', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('f0110000-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'f0110000-0000-4000-8000-000000000001', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'f0110000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-00000000000b', 'f0110000-0000-4000-8000-000000000003', 'owner');

create temporary table drafted (n int, result jsonb);
grant all on drafted to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into drafted select 1, public.record_follow_up(
  '00000000-0000-4000-8000-0000000000a1', 't3-follow-up@test', 'claude-sonnet-5',
  '{"subject":"Following up on reporting","greeting":"Hi Dana,","opening":"Thanks for the time today.","closing":"Best,",
    "lines":[
      {"kind":"recap","text":"Exporting takes most of a Friday afternoon.","segment_id":"00000000-0000-4000-8000-000000000a11","quote":"takes us most of Friday afternoon"},
      {"kind":"recap","text":"Made up.","segment_id":"00000000-0000-4000-8000-000000000a11","quote":"we would pay anything"},
      {"kind":"next_step","text":"Not a segment.","segment_id":"brief","quote":"anything"}
    ]}'::jsonb);

select is((select result ->> 'recorded' from drafted where n = 1), '1', 'a line quoting its segment is stored');
select is((select result ->> 'rejected' from drafted where n = 1), '2', 'and lines quoting what was not said, or no segment, are not');
select is(
  (select drafted_by from public.follow_ups where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  'f0110000-0000-4000-8000-000000000001'::uuid,
  'the draft records who asked for it, from the session'
);

insert into drafted select 2, public.record_follow_up(
  '00000000-0000-4000-8000-0000000000a1', 't3-follow-up@test', 'claude-sonnet-5',
  '{"subject":"Second try","greeting":"","opening":"","closing":"","lines":[]}'::jsonb);
select is(
  (select array_agg(subject) from public.follow_ups where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  array['Second try'],
  'drafting again replaces the call''s draft'
);
select is((select count(*)::int from public.follow_up_lines), 0, 'and its lines with it');

select throws_ok(
  $$ select public.record_follow_up('00000000-0000-4000-8000-0000000000a1', 't', 'm', '{"lines":[]}'::jsonb) $$,
  '22023', null, 'a draft has a subject'
);

-- Another company.
select set_config('request.jwt.claims',
  '{"sub":"f0110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.record_follow_up('00000000-0000-4000-8000-0000000000a1', 't', 'm', '{"subject":"x","lines":[]}'::jsonb) $$,
  'P0002', null, 'another company cannot draft one for this call'
);
select is((select count(*)::int from public.follow_ups), 0, 'nor read the drafts there are');

-- Erasure takes it.
select set_config('request.jwt.claims',
  '{"sub":"f0110000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.follow_ups), 1, 'an owner reads the company''s drafts');
select public.erase_conversation('00000000-0000-4000-8000-0000000000a1');
reset role;
select is((select count(*)::int from public.follow_ups where conversation_id = '00000000-0000-4000-8000-0000000000a1'), 0,
  'erasing the call erases its draft');

select * from finish();
rollback;
