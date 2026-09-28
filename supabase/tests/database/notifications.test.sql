-- Notifications: the right person hears, nobody hears of their own action,
-- nobody else can read them, only a recipient marks them read, and erasing
-- the thing a notification is about erases the notification.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email, aud, role) values
  ('a0f10001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('a0f10001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('a0f10001-0000-4000-8000-000000000003', 'coach@acme.test', 'authenticated', 'authenticated'),
  ('a0f10001-0000-4000-8000-000000000004', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('a0f10001-0000-4000-8000-000000000004', 'test operator');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'a0f10001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', 'a0f10001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000a', 'a0f10001-0000-4000-8000-000000000003', 'owner');

insert into public.conversations (id, company_id, title, added_by)
values ('a0f10001-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a', 'Seller''s call',
        'a0f10001-0000-4000-8000-000000000002');
insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
values ('a0f10001-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000a',
        'a0f10001-0000-4000-8000-0000000000c1', 'customer', 0, 5000, 'It takes us most of Friday.');

-- ---------------------------------------------------------------------------
-- A new insight tells the owners, not whoever asked for it
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000001","role":"authenticated"}', true);
reset role;
-- Inserted as if by the first owner's request (auth.uid() is theirs).
insert into public.insights (id, company_id, title, summary, synthesiser, model, status)
values ('a0f10001-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
        'Exports take a day', 'Several customers lose Fridays.', 't3@test', 'claude-sonnet-5', 'proposed');
select results_eq(
  $$ select user_id from public.notifications where kind = 'insight_proposed' $$,
  $$ values ('a0f10001-0000-4000-8000-000000000003'::uuid) $$,
  'the other owner hears of a proposed insight; the one who asked for it does not, nor a member'
);

-- ---------------------------------------------------------------------------
-- A note tells whoever added the call — unless they wrote it
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000003","role":"authenticated"}', true);
create temporary table note as
  select public.add_segment_note('a0f10001-0000-4000-8000-0000000000d1', 'Ask what a Friday costs.') as id;
select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.add_segment_note('a0f10001-0000-4000-8000-0000000000d1', 'Will do.') $$,
  'the seller replies on their own call'
);
select is(
  (select count(*)::integer from public.notifications where kind = 'note_on_your_call'),
  1,
  'the seller hears of the coach''s note, and not of their own'
);
select is(
  (select actor from public.notifications where kind = 'note_on_your_call'),
  'a0f10001-0000-4000-8000-000000000003'::uuid,
  'and it says who wrote it'
);

-- ---------------------------------------------------------------------------
-- Only the recipient reads or marks them
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.notifications), 0, 'nobody reads another person''s notifications');
select is(public.mark_notifications_read(), 0, 'or marks them read');

select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.notifications), 0, 'not even an operator');

select set_config('request.jwt.claims',
  '{"sub":"a0f10001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(public.mark_notifications_read(), 1, 'the recipient marks theirs read');
select is(public.mark_notifications_read(), 0, 'and a second time changes nothing');

-- ---------------------------------------------------------------------------
-- A teammate request answered
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.access_requests (id, company_id, requested_by, email, role)
values ('a0f10001-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a',
        'a0f10001-0000-4000-8000-000000000001', 'new@acme.test', 'member');
update public.access_requests
   set resolved_at = now(), resolved_by = 'a0f10001-0000-4000-8000-000000000004',
       resolution = 'declined', resolution_note = 'use your work address'
 where id = 'a0f10001-0000-4000-8000-0000000000e1';
select is(
  (select user_id from public.notifications where kind = 'request_answered'),
  'a0f10001-0000-4000-8000-000000000001'::uuid,
  'the owner who asked hears the answer'
);

-- ---------------------------------------------------------------------------
-- Erasure takes them
-- ---------------------------------------------------------------------------
delete from public.segment_notes where id = (select id from note);
select is(
  (select count(*)::integer from public.notifications where kind = 'note_on_your_call'),
  0,
  'deleting a note deletes the notification about it'
);
delete from public.conversations where id = 'a0f10001-0000-4000-8000-0000000000c1';
delete from public.insights where id = 'a0f10001-0000-4000-8000-0000000000a1';
select is(
  (select count(*)::integer from public.notifications where kind = 'insight_proposed'),
  0,
  'and deleting an insight deletes the notifications about it'
);
select throws_ok(
  $$ insert into public.notifications (company_id, user_id, kind)
     values ('00000000-0000-4000-8000-00000000000a', 'a0f10001-0000-4000-8000-000000000001', 'insight_proposed') $$,
  '23514', null,
  'a notification always points at what it is about'
);

select * from finish();
rollback;
