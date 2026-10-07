-- The overlay's Glass theme: stored like any other look, and still the only
-- new value the function takes. Runs with `supabase test db` (pgTAP). Rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (id, email, aud, role) values
  ('91a50000-0000-4000-8000-000000000001', 'glass@acme.test', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91a50000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(public.set_overlay_look('{"theme": "glass", "opacity": 60}') ->> 'theme', 'glass', 'a seller can choose the Glass look');
select is((select overlay_look ->> 'opacity' from public.user_preferences), '60', 'with how much white over the frost');
select throws_ok($$ select public.set_overlay_look('{"theme": "neon"}') $$, '22023', null, 'and a theme that does not exist is still refused');

select * from finish();
rollback;
