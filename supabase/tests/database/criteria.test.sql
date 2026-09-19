-- criteria_definitions: readable by anyone signed in, writable by nobody
-- through the API, and internally consistent enough for the scoring engine to
-- accept. Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
  (select count(*)::int from public.criteria_definitions
   where engagement_type = 'discovery' and version = 1),
  5,
  'the discovery set ships with the migration'
);

-- packages/scoring rejects a set whose thresholds are out of order, so a row
-- that would produce one must not be storable in the first place.
select throws_ok(
  $$ insert into public.criteria_definitions
       (engagement_type, version, key, label, definition, candidate_threshold, confirm_threshold, position)
     values ('discovery', 2, 'impossible', 'Impossible', 'x', 0.9, 0.5, 1) $$,
  '23514',
  null,
  'candidate threshold cannot exceed the confirm threshold'
);

select throws_ok(
  $$ insert into public.criteria_definitions
       (engagement_type, version, key, label, definition, weight, position)
     values ('discovery', 2, 'weightless', 'Weightless', 'x', 0, 1) $$,
  '23514',
  null,
  'a criterion cannot weigh nothing'
);

-- A new engagement type is a row, which is the entire reason this table exists.
select lives_ok(
  $$ insert into public.criteria_definitions
       (engagement_type, version, key, label, definition, position)
     values ('renewal', 1, 'usage_reviewed', 'Usage reviewed', 'The customer discusses how much they use it.', 1) $$,
  'a new engagement type is an insert, not a deploy'
);

-- Versions coexist: a conversation pins the version it was scored against.
select lives_ok(
  $$ insert into public.criteria_definitions
       (engagement_type, version, key, label, definition, position)
     values ('discovery', 2, 'pain_quantified', 'Pain quantified', 'Reworded for v2.', 1) $$,
  'a second version of a set can exist beside the first'
);

set local role authenticated;

select isnt_empty(
  $$ select 1 from public.criteria_definitions where engagement_type = 'discovery' $$,
  'a signed-in user can read criteria'
);

select throws_ok(
  $$ insert into public.criteria_definitions
       (engagement_type, version, key, label, definition, position)
     values ('discovery', 3, 'planted', 'Planted', 'x', 1) $$,
  '42501',
  null,
  'a signed-in user cannot write criteria'
);

reset role;

select * from finish();
rollback;
