-- One transaction for a whole transcript. ADR 0008.
--
-- supabase-js cannot span a transaction across calls, so writing a
-- conversation, its segments and their embeddings as three round trips left a
-- window where a failure stranded a half-written conversation: present in the
-- UI, missing from every later search. The client compensated by deleting what
-- it had written, which is only as reliable as the compensating delete —
-- itself a network call that can fail, and useless if the process dies.
--
-- A function body is a transaction. Either the whole transcript lands or none
-- of it does, with no cleanup path to get wrong.
--
-- Embeddings arrive with the segments because they are computed before any
-- write: embedding is the slow, failure-prone step, and doing it first means a
-- model or network failure happens before the database has been touched.

create function public.ingest_transcript(
  p_company_id  uuid,
  p_title       text,
  p_occurred_at timestamptz,
  p_model       text,
  -- [{ id, speaker, start_ms, end_ms, text, embedding: [768 numbers] }]
  p_segments    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if p_company_id is null then
    raise exception 'ingest_transcript: p_company_id is required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'ingest_transcript: p_title is required';
  end if;
  if p_model is null or length(trim(p_model)) = 0 then
    raise exception 'ingest_transcript: p_model is required';
  end if;
  if p_segments is null
     or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) = 0 then
    raise exception 'ingest_transcript: p_segments must be a non-empty array';
  end if;

  insert into public.conversations (company_id, title, occurred_at)
  values (p_company_id, trim(p_title), p_occurred_at)
  returning id into v_conversation_id;

  -- Segment ids come from the caller, so the caller already knows which id
  -- holds which words and never has to match rows back by their contents.
  insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
  select
    (s->>'id')::uuid,
    p_company_id,
    v_conversation_id,
    s->>'speaker',
    (s->>'start_ms')::integer,
    (s->>'end_ms')::integer,
    s->>'text'
  from jsonb_array_elements(p_segments) as s;

  -- A malformed or wrong-width vector raises here, and the conversation and
  -- its segments go with it.
  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select
    (s->>'id')::uuid,
    p_company_id,
    (s->>'embedding')::extensions.vector(768),
    p_model
  from jsonb_array_elements(p_segments) as s;

  return v_conversation_id;
end;
$$;

-- Ingest runs server-side under the service role, like match_segments. A user
-- JWT has no write path to any of these tables and must not gain one here.
revoke all on function public.ingest_transcript(uuid, text, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_transcript(uuid, text, timestamptz, text, jsonb)
  to service_role;
