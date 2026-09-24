-- Two tenants with deliberately identical content — the P0 gate fixture.
--
-- Both companies hold the same quote with the same embedding. A similarity
-- search that forgets its tenant filter therefore returns the other company's
-- row with exactly the top score: the leak cannot hide behind a ranking
-- accident. Each company also has one unrelated segment, orthogonal to the
-- query, so tests can check the similarity threshold does real work.
--
-- IDs are fixed and mirrored in packages/db/src/testing.ts. Users are not
-- seeded here; integration tests create them through the auth admin API.

insert into public.companies (id, name) values
  ('00000000-0000-4000-8000-00000000000a', 'Acme Robotics'),
  ('00000000-0000-4000-8000-00000000000b', 'Globex Logistics');

insert into public.conversations (id, company_id, title, occurred_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   'Acme — discovery call', '2026-09-01T15:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b',
   'Globex — discovery call', '2026-09-02T15:00:00Z');

insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text) values
  -- Identical quote in both tenants.
  ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-0000000000a1', 'customer', 61000, 68500,
   'Exporting the weekly report takes us most of Friday afternoon.'),
  ('00000000-0000-4000-8000-000000000b11', '00000000-0000-4000-8000-00000000000b',
   '00000000-0000-4000-8000-0000000000b1', 'customer', 42000, 49500,
   'Exporting the weekly report takes us most of Friday afternoon.'),
  -- Unrelated segment per tenant.
  ('00000000-0000-4000-8000-000000000a12', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-0000000000a1', 'customer', 120000, 126000,
   'Our warehouse team mostly works nights.'),
  ('00000000-0000-4000-8000-000000000b12', '00000000-0000-4000-8000-00000000000b',
   '00000000-0000-4000-8000-0000000000b1', 'customer', 98000, 104000,
   'Our warehouse team mostly works nights.');

-- Query-aligned vector: every component equal. Unrelated vector: alternating
-- sign, which has cosine similarity 0 with the aligned one.
insert into public.segment_embeddings (segment_id, company_id, embedding, model)
select
  s.id,
  s.company_id,
  case
    when s.id in ('00000000-0000-4000-8000-000000000a11', '00000000-0000-4000-8000-000000000b11')
      then array_fill(1::real, array[384])::extensions.vector(384)
    else (
      select array_agg(case when i % 2 = 0 then 1::real else -1::real end order by i)
      from generate_series(1, 384) as i
    )::extensions.vector(384)
  end,
  'fixture'
from public.segments s;
