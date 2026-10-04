-- The landing page's pricing: a visitor reads the plans on sale and the
-- trial, and nothing else of the catalogue. Runs with `supabase test db`
-- (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select set_eq(
  $$ select id from public.plans $$,
  $$ values ('trial'), ('basic'), ('pro') $$,
  'a visitor reads the trial and the plans on sale'
);
select is_empty(
  $$ select 1 from public.plans where id in ('pilot', 'internal', 'none') $$,
  'and not the plans that are granted, not sold'
);

select * from finish();
rollback;
