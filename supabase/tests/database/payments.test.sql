-- Payments (ADR 0025): plans stay free until an operator sets Stripe's
-- signing secret and both prices; then a paid plan starts only at checkout,
-- for an owner; Stripe's events count only when signed with the secret, fresh,
-- and once; what they say becomes the plan, the period and a cancel at its
-- end; a company paying through Stripe changes and cancels in billing; and
-- the end of the subscription is the end of the plan. Runs with
-- `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email, aud, role) values
  ('9a000000-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('9a000000-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('9a000000-0000-4000-8000-000000000003', 'op@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '9a000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '9a000000-0000-4000-8000-000000000002', 'member');
insert into public.platform_admins (user_id, note) values ('9a000000-0000-4000-8000-000000000003', 'payments test');
select private.apply_plan('00000000-0000-4000-8000-00000000000a', 'trial', 'set_by_operator', 'operator', null);

-- Events, signed as Stripe signs them, made here where the secret is known.
create temporary table ev (name text primary key, payload text, signature text);
grant select on ev to anon, authenticated;
create function pg_temp.sign(p_payload text, p_secret text, p_time bigint) returns text language sql as $$
  select 't=' || p_time || ',v1=' || encode(extensions.hmac(convert_to(p_time || '.' || p_payload, 'UTF8'), convert_to(p_secret, 'UTF8'), 'sha256'), 'hex')
$$;
insert into ev (name, payload) values
  ('checkout', '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"client_reference_id":"00000000-0000-4000-8000-00000000000a","customer":"cus_A","subscription":"sub_A","metadata":{"plan":"basic"}}}}'),
  ('to_pro', format('{"id":"evt_2","type":"customer.subscription.updated","data":{"object":{"id":"sub_A","customer":"cus_A","status":"active","cancel_at_period_end":true,"items":{"data":[{"price":{"id":"price_Pro1"},"current_period_start":%s,"current_period_end":%s}]}}}}',
     extract(epoch from now())::bigint, extract(epoch from now() + interval '30 days')::bigint)),
  ('deleted', '{"id":"evt_3","type":"customer.subscription.deleted","data":{"object":{"id":"sub_A","customer":"cus_A","status":"canceled","items":{"data":[{"price":{"id":"price_Pro1"}}]}}}}');
update ev set signature = pg_temp.sign(payload, 'whsec_testsecret', extract(epoch from now())::bigint);
insert into ev (name, payload, signature)
select 'stale', payload, pg_temp.sign(payload, 'whsec_testsecret', extract(epoch from now() - interval '10 minutes')::bigint)
  from ev where name = 'checkout';

set local role anon;
select throws_ok($$ select public.stripe_event((select payload from ev where name = 'checkout'), (select signature from ev where name = 'checkout')) $$,
  '55000', null, 'before payments are set up, no event counts');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9a000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.admin_set_stripe_webhook_secret('whsec_testsecret');
select is(public.payments_ready(), false, 'a secret without prices is not payments');
select public.admin_set_plan_price('basic', 'price_Basic1');
select public.admin_set_plan_price('pro', 'price_Pro1');
select throws_ok($$ select public.admin_set_plan_price('pilot', 'price_X') $$, '22023', null, 'only Basic and Pro are sold');
select is(public.payments_ready(), true, 'with both prices, payments are on');
select is((select admin_payments_status() ->> 'webhook_secret_hint'), 'cret', 'the console sees the secret''s end, never the secret');
select is((select string_agg(setting || ':' || detail, ' | ' order by at, detail) from public.payment_setting_events),
  'price:basic: price_Basic1 | price:pro: price_Pro1 | webhook_secret:set, ending cret', 'what operators changed is recorded');

select set_config('request.jwt.claims', '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.change_plan('basic') $$, '22023', 'change_plan: a paid plan starts at checkout',
  'once payments are on, a paid plan does not start for free');
select is((select billing_checkout('basic') ->> 'price_id'), 'price_Basic1', 'checkout gets the plan''s price, for an owner');
select set_config('request.jwt.claims', '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.billing_checkout('basic') $$, '42501', null, 'and not for a member');

set local role anon;
select throws_ok($$ select public.stripe_event((select payload from ev where name = 'checkout'), 't=1,v1=00') $$,
  '28000', null, 'an event signed with anything else changes nothing');
select throws_ok($$ select public.stripe_event((select payload from ev where name = 'stale'), (select signature from ev where name = 'stale')) $$,
  '28000', null, 'nor one signed ten minutes ago');
select throws_ok($$ select public.stripe_event(replace((select payload from ev where name = 'checkout'), 'basic', 'pro'), (select signature from ev where name = 'checkout')) $$,
  '28000', null, 'nor one changed after it was signed');

select is(public.stripe_event((select payload from ev where name = 'checkout'), (select signature from ev where name = 'checkout')),
  'synced basic', 'a signed checkout starts the plan, whoever delivers it');
select is(public.stripe_event((select payload from ev where name = 'checkout'), (select signature from ev where name = 'checkout')),
  'duplicate', 'and the same event again does nothing');

reset role;
select is((select plan from public.companies where id = '00000000-0000-4000-8000-00000000000a'), 'basic', 'the company is on Basic');
select is((select provider || ':' || provider_customer_id || ':' || provider_subscription_id from public.subscriptions where company_id = '00000000-0000-4000-8000-00000000000a'),
  'stripe:cus_A:sub_A', 'paid through Stripe, with its customer and subscription');

set local role anon;
select is(public.stripe_event((select payload from ev where name = 'to_pro'), (select signature from ev where name = 'to_pro')),
  'synced pro', 'a change in Stripe''s billing page comes back as the plan');
reset role;
select ok((select plan = 'pro' and s.cancel_at_period_end and s.period_end > now() + interval '29 days'
             from public.companies c join public.subscriptions s on s.company_id = c.id where c.id = '00000000-0000-4000-8000-00000000000a'),
  'with Stripe''s period and its cancel at the end');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.change_plan('basic') $$, '22023', 'change_plan: you pay through Stripe; change the plan in billing',
  'a company paying through Stripe changes plan in billing');
select throws_ok($$ select public.cancel_plan() $$, '22023', 'cancel_plan: you pay through Stripe; cancel in billing', 'and cancels there');
select throws_ok($$ select public.billing_checkout('pro') $$, '22023', null, 'and never starts a second subscription');
select is(public.billing_customer(), 'cus_A', 'billing opens on its Stripe customer');
select is((select count(*)::int from public.stripe_events), 0, 'an owner does not read Stripe''s events');

set local role anon;
select public.stripe_event((select payload from ev where name = 'deleted'), (select signature from ev where name = 'deleted'));
reset role;
select is((select c.plan || ':' || s.provider || ':' || coalesce(s.provider_customer_id, '-')
             from public.companies c join public.subscriptions s on s.company_id = c.id where c.id = '00000000-0000-4000-8000-00000000000a'),
  'none:none:cus_A', 'the end of the subscription is the end of the plan, and the customer is kept for the next');

-- Another company on a free Pro from before payments: its period ends, and it
-- does not renew for free.
reset role;
select private.apply_plan('00000000-0000-4000-8000-00000000000b', 'pro', 'set_by_operator', 'operator', null);
update public.subscriptions set period_end = now() - interval '1 minute' where company_id = '00000000-0000-4000-8000-00000000000b';
select private.roll_subscription('00000000-0000-4000-8000-00000000000b');
select is((select plan from public.companies where id = '00000000-0000-4000-8000-00000000000b'), 'none',
  'once payments are on, a free plan from before ends with its period instead of renewing');

-- Stripe signs as Node's crypto does (a vector made with it), UTF-8 and all.
select ok(private.stripe_signature_ok('{"id":"evt_vector","note":"Café ☕ — £40k"}',
  't=1791000000,v1=43ef2c9fa7dce2323603bdb5cc551e98e4252ae60a0c757edda72edcdc5e624f', 'whsec_vectorSecret', to_timestamp(1791000000)),
  'the signature check agrees with Stripe''s HMAC, byte for byte');

select * from finish();
rollback;
