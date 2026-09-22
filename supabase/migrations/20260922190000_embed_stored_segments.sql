-- Embedding segments that are already in the database.
--
-- Until now the only way a segment got a vector was `ingest_transcript()`,
-- which writes the conversation, its segments and their embeddings together.
-- That is right for an import, and useless for a live call: the segments
-- arrived one at a time while somebody was talking, long before anything
-- could be embedded.
--
-- The consequence was quiet and total. A live-captured call has segments and
-- criterion events, so it scores and appears on the dashboard — and it has no
-- vectors, so `retrieve()` cannot see it, so it can never contribute to an
-- insight. The live surface produced scorecards and nothing else.
--
-- A function rather than an upsert from the client, for ADR 0008's reason: a
-- row written against the wrong tenant is a leak that outlives the bug which
-- caused it and reappears in every later search, so the tenant is checked
-- here, against the segment's own company, and never taken on trust.

create function public.embed_stored_segments(
  p_company_id uuid,
  p_model      text,
  -- [{ segment_id, embedding }]
  p_rows       jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_written integer;
begin
  if p_company_id is null then
    raise exception 'embed_stored_segments: p_company_id is required';
  end if;
  if p_model is null or length(trim(p_model)) = 0 then
    raise exception 'embed_stored_segments: p_model is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'embed_stored_segments: p_rows must be an array';
  end if;

  -- The join is the tenant check. A segment id belonging to another company
  -- simply does not match, so it is skipped rather than written against the
  -- company that asked for it — which is the failure this guards.
  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select s.id, s.company_id, (r->>'embedding')::extensions.vector(768), p_model
  from jsonb_array_elements(p_rows) as r
  join public.segments s
    on s.id = (r->>'segment_id')::uuid
   and s.company_id = p_company_id
  -- Re-embedding with a newer model replaces the vector; the same model twice
  -- is a no-op worth tolerating, because a re-run after a half-finished pass
  -- is the normal way this gets used.
  on conflict (segment_id) do update
    set embedding = excluded.embedding,
        model     = excluded.model;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function public.embed_stored_segments(uuid, text, jsonb) is
  'Adds vectors to segments already written — the live path, where segments arrive before anything can embed them. Import uses ingest_transcript() instead.';

-- Operator only, like every other write to this table. Nothing signed in has
-- any business putting a vector in it.
revoke all on function public.embed_stored_segments(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.embed_stored_segments(uuid, text, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- Which segments still need one
-- ---------------------------------------------------------------------------
-- A function rather than a query in the caller, so that the only code naming
-- the embeddings table stays inside the retrieval module (ADR 0004's grep
-- guard). A caller asking "what is missing" would otherwise have to name it.

create function public.segments_without_embeddings(
  p_company_id      uuid,
  p_conversation_id uuid default null
)
returns table (id uuid, speaker text, start_ms integer, end_ms integer, text text)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.speaker, s.start_ms, s.end_ms, s.text
  from public.segments s
  left join public.segment_embeddings e on e.segment_id = s.id
  where s.company_id = p_company_id
    and (p_conversation_id is null or s.conversation_id = p_conversation_id)
    and e.segment_id is null
  order by s.start_ms;
$$;

revoke all on function public.segments_without_embeddings(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.segments_without_embeddings(uuid, uuid) to service_role;
