-- A company's knowledge: owners add and delete documents, members read the
-- list; passages are read only through match_knowledge, which finds them by
-- meaning and by words, for the caller's own company only; a document holds
-- its passages once, and closing the company forgets it all.
-- Runs with `supabase test db` (pgTAP). Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, aud, role) values
  ('4b000001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('4b000001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('4b000001-0000-4000-8000-000000000003', 'rival@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '4b000001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '4b000001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '4b000001-0000-4000-8000-000000000003', 'owner');

-- Unit vectors: a passage points one way, a question another.
create function pg_temp.unit(p_at integer) returns text language sql as $$
  select '[' || string_agg(case when i = p_at then '1' else '0' end, ',' order by i) || ']' from generate_series(1, 384) i
$$;

create temporary table made (label text, id uuid);
grant all on made to authenticated;
grant execute on function pg_temp.unit(integer) to authenticated;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"4b000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.create_knowledge_document('Pricing', 'pasted') $$, '42501', null, 'a member does not add to the knowledge');

select set_config('request.jwt.claims', '{"sub":"4b000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select 'doc', public.create_knowledge_document('Pricing and rollout', 'pasted');
select is((select status from public.knowledge_documents), 'processing', 'an owner starts a document');
select is(
  public.record_knowledge_chunks((select id from made where label = 'doc'), jsonb_build_array(
    jsonb_build_object('ordinal', 0, 'text', 'Pro is twenty dollars a seat a month.', 'embedding', pg_temp.unit(1)),
    jsonb_build_object('ordinal', 1, 'text', 'Rollout takes two weeks for a team of fifty.', 'embedding', pg_temp.unit(2))
  ), 90),
  2, 'and records its passages'
);
select is((select status || '/' || passages from public.knowledge_documents), 'ready/2', 'which makes it ready');
select throws_ok(
  $$ select public.record_knowledge_chunks((select id from made where label = 'doc'),
       jsonb_build_array(jsonb_build_object('ordinal', 5, 'text', 'Again.', 'embedding', pg_temp.unit(3))), 6) $$,
  '22023', null, 'a document takes its passages once'
);

-- By meaning, and by words.
select is(
  (select m.text from public.match_knowledge('00000000-0000-4000-8000-00000000000a', pg_temp.unit(1)::extensions.vector, 'price', 1) m),
  'Pro is twenty dollars a seat a month.', 'the passage nearest in meaning comes first'
);
select ok(
  exists (select 1 from public.match_knowledge('00000000-0000-4000-8000-00000000000a', pg_temp.unit(3)::extensions.vector, 'how long is the rollout', 1) m
           where m.text like 'Rollout%'),
  'a passage sharing the question''s words comes first when meaning cannot tell'
);

-- Members read the list, never the passages directly.
select set_config('request.jwt.claims', '{"sub":"4b000001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.knowledge_documents), 1, 'a member reads the company''s documents');
select is((select count(*)::int from public.knowledge_chunks), 0, 'but not the passages, which only match_knowledge returns');
select throws_ok($$ select public.delete_knowledge_document((select id from made where label = 'doc')) $$, '42501', null,
  'nor deletes a document');
select is(
  (select count(*)::int from public.match_knowledge('00000000-0000-4000-8000-00000000000a', pg_temp.unit(1)::extensions.vector, 'price', 5)),
  2, 'a member searches their company''s knowledge'
);

-- Another company reads none of it and cannot search it.
select set_config('request.jwt.claims', '{"sub":"4b000001-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.knowledge_documents), 0, 'another company reads none of it');
select throws_ok(
  $$ select * from public.match_knowledge('00000000-0000-4000-8000-00000000000a', pg_temp.unit(1)::extensions.vector, 'price', 5) $$,
  '42501', null, 'nor searches it'
);

-- A document that could not be read holds nothing and says why.
select set_config('request.jwt.claims', '{"sub":"4b000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into made select 'broken', public.create_knowledge_document('Scanned brochure', 'upload', 'brochure.pdf');
select lives_ok($$ select public.fail_knowledge_document((select id from made where label = 'broken'), 'No text in it.') $$,
  'a document that could not be read is marked failed');
select is((select status from public.knowledge_documents where id = (select id from made where label = 'broken')), 'failed',
  'and says so');

select lives_ok($$ select public.delete_knowledge_document((select id from made where label = 'doc')) $$, 'an owner deletes a document');
reset role;
select is((select count(*)::int from public.knowledge_chunks), 0, 'and its passages go with it');

-- Closing the company forgets what it knew.
update public.companies set closed_at = now(), closed_reason = 'test' where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.knowledge_documents where company_id = '00000000-0000-4000-8000-00000000000a'), 0,
  'closing the company deletes its knowledge');

select * from finish();
rollback;
