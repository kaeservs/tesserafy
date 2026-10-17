-- A support window ended early ends there: sessions that began after it are
-- the customer's own. And cost against price counts every seat a company pays
-- for. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, aud, role) values
  ('9f000001-0000-4000-8000-000000000001', 'customer@acme.test', 'authenticated', 'authenticated'),
  ('9f000001-0000-4000-8000-000000000002', 'op@test.tesserafy.local', 'authenticated', 'authenticated');

-- A 240-minute window opened 60 minutes ago and ended 50 minutes ago; the
-- support session inside it, then the customer's own sign-in 30 minutes ago.
insert into public.support_access (id, admin_user_id, subject_user_id, reason, expires_at, created_at, ended_at)
values ('9f000001-0000-4000-8000-0000000000b1', '9f000001-0000-4000-8000-000000000002', '9f000001-0000-4000-8000-000000000001',
        'Investigating a ticket', now() + interval '180 minutes', now() - interval '60 minutes', now() - interval '50 minutes');
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('9f000001-0000-4000-8000-0000000000a1', '9f000001-0000-4000-8000-000000000001', now() - interval '58 minutes', now()),
  ('9f000001-0000-4000-8000-0000000000a2', '9f000001-0000-4000-8000-000000000001', now() - interval '30 minutes', now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"9f000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"9f000001-0000-4000-8000-0000000000a1"}', true);
select is(public.support_session_ended(), true, 'the support session inside the window is over once the window is ended');
select is(public.in_support_session(), true, 'and it was a support session');

select set_config('request.jwt.claims',
  '{"sub":"9f000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"9f000001-0000-4000-8000-0000000000a2"}', true);
select is(public.support_session_ended(), false, 'a sign-in after the window was ended is not signed out as support');
select is(public.in_support_session(), false, 'nor treated as a support session, though the window had not yet expired');

-- Cost against price, for a company paying for three seats.
reset role;
insert into auth.users (id, email, aud, role) values
  ('9f000001-0000-4000-8000-000000000005', 'ops@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values ('9f000001-0000-4000-8000-000000000005', 'pgTAP operator');
update public.companies set plan = 'pro' where id = '00000000-0000-4000-8000-00000000000a';
insert into public.subscriptions (company_id, status, period_start, period_end, seats)
values ('00000000-0000-4000-8000-00000000000a', 'active', now(), now() + interval '1 month', 3)
  on conflict (company_id) do update set seats = 3;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9f000001-0000-4000-8000-000000000005","role":"authenticated"}', true);
select is(
  (select price_usd_cents from public.admin_company_margin(30) where company_id = '00000000-0000-4000-8000-00000000000a'),
  (select price_usd_cents * 3 from public.plans where id = 'pro'),
  'a company on three seats is measured against three seats'' price'
);
select is(
  (select price_usd_cents from public.admin_company_margin(30) where company_id = '00000000-0000-4000-8000-00000000000b'),
  null::integer,
  'a plan that is not sold still has no price'
);

select * from finish();
rollback;
