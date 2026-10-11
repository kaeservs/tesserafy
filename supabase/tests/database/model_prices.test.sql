-- The console prices each model at its own published rate (ADR 0030): Haiku
-- 5.5, which runs the criterion detector, at a tenth of Haiku 4.5, and the
-- company list with the same arithmetic as every other spend figure.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select is(private.usage_usd('claude-haiku-5-5', 1000000, 0, 0, 0), 0.1, 'Haiku 5.5: $0.10 a million tokens in');
select is(private.usage_usd('claude-haiku-5-5', 0, 0, 0, 1000000), 0.5, 'and $0.50 a million out');
select is(private.usage_usd('claude-haiku-4-5', 1000000, 0, 0, 1000000), 6.0, 'Haiku 4.5 is unchanged: $1 in, $5 out');
select is(private.usage_usd('claude-sonnet-5', 1000000, 0, 0, 1000000), 12.0, 'and Sonnet 5: $2 in, $10 out');
select is(
  private.usage_usd('claude-haiku-5-5', 0, 1000000, 1000000, 0),
  0.135,
  'a cache write costs a quarter more than input, a cache read a tenth'
);

insert into auth.users (id, email, aud, role) values
  ('ad0e0002-0000-4000-8000-000000000001', 'operator@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id, note) values
  ('ad0e0002-0000-4000-8000-000000000001', 'test operator');
insert into public.model_usage (company_id, tier, model, detector, input_tokens, output_tokens, duration_ms)
values ('00000000-0000-4000-8000-00000000000a', 't1', 'claude-haiku-5-5', 't1-detect@test', 1000000, 1000000, 10);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ad0e0002-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select spend_30d_usd from public.admin_companies() where company_id = '00000000-0000-4000-8000-00000000000a'),
  0.6000::numeric,
  'the company list prices the detector at what it costs'
);

select * from finish();
rollback;
