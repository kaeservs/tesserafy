-- Guards over the whole catalogue, so one missed line cannot expose a table or
-- a function: Supabase's default privileges give anon and authenticated every
-- privilege on a new table in public, and EXECUTE on a new function (security
-- review, 2026-10-19). Runs with `supabase test db` (pgTAP). Nothing changes.

begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select is(
  (select coalesce(array_agg(c.relname::text order by c.relname::text), '{}')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  '{}'::text[],
  'every table in public has row-level security on');

select is(
  (select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')),
  '{}'::text[],
  'every SECURITY DEFINER function pins its search_path');

-- Trigger functions cannot be called through the API, and extensions' own
-- functions are theirs; everything else anon can run is named here.
select is(
  (select coalesce(array_agg(distinct p.proname::text order by p.proname::text), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['ops_digest', 'signup_is_open', 'stripe_event']::text[],
  'anon can execute only the public functions meant for it: the ops digest, whether sign-up is open, and Stripe''s webhook');

select * from finish();
rollback;
