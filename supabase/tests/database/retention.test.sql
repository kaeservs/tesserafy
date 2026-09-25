-- An owner sets retention; nobody else can; the preview is the purge's own
-- count; and the purge is scheduled. Runs with `supabase test db`. Rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-4555-8555-555555555555', 'owner-a@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'member-a@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '55555555-5555-4555-8555-555555555555', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '66666666-6666-4666-8666-666666666666', 'member');

-- A call old enough to fall outside a 30-day window.
update public.conversations
   set occurred_at = now() - interval '60 days'
 where id = '00000000-0000-4000-8000-0000000000a1';

set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666666')::text, true);
select throws_ok(
  $$ select public.set_retention(30) $$,
  '42501', null,
  'a member who is not an owner cannot set retention'
);

select set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555')::text, true);

select is(
  public.retention_preview(30),
  (select count(*)::integer from public.conversations c
    where c.company_id = '00000000-0000-4000-8000-00000000000a'
      and coalesce(c.occurred_at, c.created_at) < now() - interval '30 days'),
  'the preview is the purge''s own count'
);

select ok(public.retention_preview(30) >= 1, 'and it counts the 60-day-old call');

select lives_ok($$ select public.set_retention(30) $$, 'an owner sets retention');

select throws_ok(
  $$ select public.set_retention(3) $$,
  '22023', null,
  'a period shorter than a week is refused'
);

select lives_ok($$ select public.set_retention(null) $$, 'an owner can go back to keeping everything');

reset role;
select is(
  (select count(*)::integer from cron.job where jobname = 'purge-expired-conversations'),
  1,
  'the purge is scheduled, once'
);

select * from finish();
rollback;
