-- Internal companies get their own limits; customers keep theirs.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- Company A becomes internal; company B stays a customer.
update public.companies set plan = 'internal' where id = '00000000-0000-4000-8000-00000000000a';

insert into auth.users (id, email, aud, role) values
  ('33333333-3333-4333-8333-333333333333', 'internal@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'customer@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id) values
  ('00000000-0000-4000-8000-00000000000a', '33333333-3333-4333-8333-333333333333'),
  ('00000000-0000-4000-8000-00000000000b', '44444444-4444-4444-8444-444444444444');

set local role authenticated;

-- Customer limit 1 a day; internal limit 5 a day.

select set_config('request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-8444-444444444444')::text, true);
select public.take_rate_limit_tokens('probe', '[{"seconds":86400,"limit":1}]', '[{"seconds":86400,"limit":5}]');
select is(
  (public.take_rate_limit_tokens('probe', '[{"seconds":86400,"limit":1}]', '[{"seconds":86400,"limit":5}]') ->> 'allowed')::boolean,
  false,
  'a customer is held to the customer limit'
);

select set_config('request.jwt.claims',
  json_build_object('sub', '33333333-3333-4333-8333-333333333333')::text, true);
select public.take_rate_limit_tokens('probe', '[{"seconds":86400,"limit":1}]', '[{"seconds":86400,"limit":5}]');
select is(
  (public.take_rate_limit_tokens('probe', '[{"seconds":86400,"limit":1}]', '[{"seconds":86400,"limit":5}]') ->> 'allowed')::boolean,
  true,
  'an internal member is held to the internal limit instead'
);

select is(
  (public.take_rate_limit_tokens('probe-no-internal', '[{"seconds":86400,"limit":1}]') ->> 'allowed')::boolean,
  true,
  'a call without internal limits still works, as the deployed app makes it'
);

select is(
  (public.take_rate_limit_tokens('probe-no-internal', '[{"seconds":86400,"limit":1}]') ->> 'allowed')::boolean,
  false,
  'and without internal limits an internal member gets the ordinary ones'
);

select * from finish();
rollback;
